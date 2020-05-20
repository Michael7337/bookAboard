(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.asr = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
module.exports = { reverse: false }
},{}],2:[function(require,module,exports){
const StateState = require('./lib/state-state')
const StateComparison = require('./lib/state-comparison')
const CurrentState = require('./lib/current-state')
const stateChangeLogic = require('./lib/state-change-logic')
const parse = require('./lib/state-string-parser')
const StateTransitionManager = require('./lib/state-transition-manager')
const defaultRouterOptions = require('./default-router-options.js')

const series = require('./lib/promise-map-series')
const extend = require('./lib/extend.js')

const denodeify = require('then-denodeify')
const EventEmitter = require('eventemitter3')
const newHashBrownRouter = require('hash-brown-router')
const combine = require('combine-arrays')
const buildPath = require('page-path-builder')
const nextTick = require('iso-next-tick')

const getProperty = name => obj => obj[name]
const reverse = ary => ary.slice().reverse()
const isFunction = property => obj => typeof obj[property] === 'function'
const isThenable = object => object && (typeof object === 'object' || typeof object === 'function') && typeof object.then === 'function'
const promiseMe = (fn, ...args) => new Promise(resolve => resolve(fn(...args)))

const expectedPropertiesOfAddState = [ 'name', 'route', 'defaultChild', 'data', 'template', 'resolve', 'activate', 'querystringParameters', 'defaultQuerystringParameters', 'defaultParameters' ]

module.exports = function StateProvider(makeRenderer, rootElement, stateRouterOptions = {}) {
	const prototypalStateHolder = StateState()
	const lastCompletelyLoadedState = CurrentState()
	const lastStateStartedActivating = CurrentState()
	const stateProviderEmitter = new EventEmitter()
	const compareStartAndEndStates = StateComparison(prototypalStateHolder)

	const stateNameToArrayofStates = stateName => parse(stateName).map(prototypalStateHolder.get)

	StateTransitionManager(stateProviderEmitter)
	const { throwOnError, pathPrefix } = extend({
		throwOnError: true,
		pathPrefix: '#',
	}, stateRouterOptions)

	const router = stateRouterOptions.router || newHashBrownRouter(defaultRouterOptions)

	router.on('not found', (route, parameters) => {
		stateProviderEmitter.emit('routeNotFound', route, parameters)
	})

	let destroyDom = null
	let getDomChild = null
	let renderDom = null
	let resetDom = null

	let activeStateResolveContent = {}
	const activeDomApis = {}
	const activeEmitters = {}

	function handleError(event, err) {
		nextTick(() => {
			stateProviderEmitter.emit(event, err)
			console.error(`${event} - ${err.message}`)
			if (throwOnError) {
				throw err
			}
		})
	}

	function destroyStateName(stateName) {
		const state = prototypalStateHolder.get(stateName)
		stateProviderEmitter.emit('beforeDestroyState', {
			state: state,
			domApi: activeDomApis[stateName],
		})

		activeEmitters[stateName].emit('destroy')
		activeEmitters[stateName].removeAllListeners()
		delete activeEmitters[stateName]
		delete activeStateResolveContent[stateName]

		return destroyDom(activeDomApis[stateName]).then(() => {
			delete activeDomApis[stateName]
			stateProviderEmitter.emit('afterDestroyState', {
				state,
			})
		})
	}

	function resetStateName(parameters, stateName) {
		const domApi = activeDomApis[stateName]
		const content = getContentObject(activeStateResolveContent, stateName)
		const state = prototypalStateHolder.get(stateName)

		stateProviderEmitter.emit('beforeResetState', {
			domApi,
			content,
			state,
			parameters,
		})

		activeEmitters[stateName].emit('destroy')
		delete activeEmitters[stateName]

		return resetDom({
			domApi,
			content,
			template: state.template,
			parameters,
		}).then(newDomApi => {
			if (newDomApi) {
				activeDomApis[stateName] = newDomApi
			}

			stateProviderEmitter.emit('afterResetState', {
				domApi: activeDomApis[stateName],
				content,
				state,
				parameters,
			})
		})
	}

	function getChildElementForStateName(stateName) {
		return new Promise(resolve => {
			const parent = prototypalStateHolder.getParent(stateName)
			if (parent) {
				const parentDomApi = activeDomApis[parent.name]
				resolve(getDomChild(parentDomApi))
			} else {
				resolve(rootElement)
			}
		})
	}

	function renderStateName(parameters, stateName) {
		return getChildElementForStateName(stateName).then(element => {
			const state = prototypalStateHolder.get(stateName)
			const content = getContentObject(activeStateResolveContent, stateName)

			stateProviderEmitter.emit('beforeCreateState', {
				state,
				content,
				parameters,
			})

			return renderDom({
				template: state.template,
				element,
				content,
				parameters,
			}).then(domApi => {
				activeDomApis[stateName] = domApi
				stateProviderEmitter.emit('afterCreateState', {
					state,
					domApi,
					content,
					parameters,
				})
				return domApi
			})
		})
	}

	function renderAll(stateNames, parameters) {
		return series(stateNames, stateName => renderStateName(parameters, stateName))
	}

	function onRouteChange(state, parameters) {
		try {
			const finalDestinationStateName = prototypalStateHolder.applyDefaultChildStates(state.name)

			if (finalDestinationStateName === state.name) {
				emitEventAndAttemptStateChange(finalDestinationStateName, parameters)
			} else {
				// There are default child states that need to be applied

				const theRouteWeNeedToEndUpAt = makePath(finalDestinationStateName, parameters)
				const currentRoute = router.location.get()

				if (theRouteWeNeedToEndUpAt === currentRoute) {
					// the child state has the same route as the current one, just start navigating there
					emitEventAndAttemptStateChange(finalDestinationStateName, parameters)
				} else {
					// change the url to match the full default child state route
					stateProviderEmitter.go(finalDestinationStateName, parameters, { replace: true })
				}
			}
		} catch (err) {
			handleError('stateError', err)
		}
	}

	function addState(state) {
		if (typeof state === 'undefined') {
			throw new Error(`Expected 'state' to be passed in.`)
		} else if (typeof state.name === 'undefined') {
			throw new Error(`Expected the 'name' option to be passed in.`)
		} else if (typeof state.template === 'undefined') {
			throw new Error(`Expected the 'template' option to be passed in.`)
		}
		Object.keys(state).filter(key => {
			return expectedPropertiesOfAddState.indexOf(key) === -1
		}).forEach(key => {
			console.warn('Unexpected property passed to addState:', key)
		})

		prototypalStateHolder.add(state.name, state)

		const route = prototypalStateHolder.buildFullStateRoute(state.name)

		router.add(route, parameters => onRouteChange(state, parameters))
	}

	function getStatesToResolve(stateChanges) {
		return stateChanges.change.concat(stateChanges.create).map(prototypalStateHolder.get)
	}

	function emitEventAndAttemptStateChange(newStateName, parameters) {
		stateProviderEmitter.emit('stateChangeAttempt', function stateGo(transition) {
			attemptStateChange(newStateName, parameters, transition)
		})
	}

	function attemptStateChange(newStateName, parameters, transition) {
		function ifNotCancelled(fn) {
			return (...args) => {
				if (transition.cancelled) {
					const err = new Error(`The transition to ${newStateName} was cancelled`)
					err.wasCancelledBySomeoneElse = true
					throw err
				} else {
					return fn(...args)
				}
			}
		}

		return promiseMe(prototypalStateHolder.guaranteeAllStatesExist, newStateName)
			.then(function applyDefaultParameters() {
				const state = prototypalStateHolder.get(newStateName)
				const defaultParams = state.defaultParameters || state.defaultQuerystringParameters || {}
				const needToApplyDefaults = Object.keys(defaultParams).some(function missingParameterValue(param) {
					return typeof parameters[param] === 'undefined'
				})

				if (needToApplyDefaults) {
					throw redirector(newStateName, extend(defaultParams, parameters))
				}
				return state
			}).then(ifNotCancelled(state => {
				stateProviderEmitter.emit('stateChangeStart', state, parameters, stateNameToArrayofStates(state.name))
				lastStateStartedActivating.set(state.name, parameters)
			})).then(function getStateChanges() {
				const stateComparisonResults = compareStartAndEndStates({
					original: lastCompletelyLoadedState.get(),
					destination: {
						name: newStateName,
						parameters,
					},
				})
				return stateChangeLogic(stateComparisonResults) // { destroy, change, create }
			}).then(ifNotCancelled(function resolveDestroyAndActivateStates(stateChanges) {
				return resolveStates(getStatesToResolve(stateChanges), extend(parameters)).catch(function onResolveError(e) {
					e.stateChangeError = true
					throw e
				}).then(ifNotCancelled(function destroyAndActivate(stateResolveResultsObject) {
					transition.cancellable = false

					const activateAll = () => activateStates(
						stateChanges.change.concat(stateChanges.create)
					)

					activeStateResolveContent = extend(activeStateResolveContent, stateResolveResultsObject)

					return series(reverse(stateChanges.destroy), destroyStateName).then(() => {
						return series(
							reverse(stateChanges.change),
							stateName => resetStateName(extend(parameters), stateName)
						)
					}).then(
						() => renderAll(stateChanges.create, extend(parameters)).then(activateAll)
					)
				}))

				function activateStates(stateNames) {
					return stateNames.map(prototypalStateHolder.get).forEach(state => {
						const emitter = new EventEmitter()
						const context = Object.create(emitter)
						context.domApi = activeDomApis[state.name]
						context.data = state.data
						context.parameters = parameters
						context.content = getContentObject(activeStateResolveContent, state.name)
						activeEmitters[state.name] = emitter

						try {
							state.activate && state.activate(context)
						} catch (e) {
							nextTick(() => {
								throw e
							})
						}
					})
				}
			})).then(function stateChangeComplete() {
				lastCompletelyLoadedState.set(newStateName, parameters)
				try {
					stateProviderEmitter.emit('stateChangeEnd', prototypalStateHolder.get(newStateName), parameters, stateNameToArrayofStates(newStateName))
				} catch (e) {
					handleError('stateError', e)
				}
			}).catch(ifNotCancelled(function handleStateChangeError(err) {
				if (err && err.redirectTo) {
					stateProviderEmitter.emit('stateChangeCancelled', err)
					return stateProviderEmitter.go(err.redirectTo.name, err.redirectTo.params, { replace: true })
				} else if (err) {
					handleError('stateChangeError', err)
				}
			})).catch(function handleCancellation(err) {
				if (err && err.wasCancelledBySomeoneElse) {
					// we don't care, the state transition manager has already emitted the stateChangeCancelled for us
				} else {
					throw new Error(`This probably shouldn't happen, maybe file an issue or something ${err}`)
				}
			})
	}

	function makePath(stateName, parameters, options) {
		function getGuaranteedPreviousState() {
			if (!lastStateStartedActivating.get().name) {
				throw new Error('makePath required a previous state to exist, and none was found')
			}
			return lastStateStartedActivating.get()
		}
		if (options && options.inherit) {
			parameters = extend(getGuaranteedPreviousState().parameters, parameters)
		}

		const destinationStateName = stateName === null ? getGuaranteedPreviousState().name : stateName

		const destinationState = prototypalStateHolder.get(destinationStateName) || {}
		const defaultParams = destinationState.defaultParameters || destinationState.defaultQuerystringParameters

		parameters = extend(defaultParams, parameters)

		prototypalStateHolder.guaranteeAllStatesExist(destinationStateName)
		const route = prototypalStateHolder.buildFullStateRoute(destinationStateName)
		return buildPath(route, parameters || {})
	}

	const defaultOptions = {
		replace: false,
	}

	stateProviderEmitter.addState = addState
	stateProviderEmitter.go = (newStateName, parameters, options) => {
		options = extend(defaultOptions, options)
		const goFunction = options.replace ? router.replace : router.go

		return promiseMe(makePath, newStateName, parameters, options)
			.then(goFunction, err => handleError('stateChangeError', err))
	}
	stateProviderEmitter.evaluateCurrentRoute = (defaultState, defaultParams) => {
		return promiseMe(makePath, defaultState, defaultParams).then(defaultPath => {
			router.evaluateCurrent(defaultPath)
		}).catch(err => handleError('stateError', err))
	}
	stateProviderEmitter.makePath = (stateName, parameters, options) => {
		return pathPrefix + makePath(stateName, parameters, options)
	}
	stateProviderEmitter.getActiveState = () => {
		return lastCompletelyLoadedState.get()
	}
	stateProviderEmitter.stateIsActive = (stateName, parameters = null) => {
		const currentState = lastCompletelyLoadedState.get()
		const stateNameMatches = currentState.name === stateName || currentState.name.indexOf(stateName + '.') === 0
		const parametersWereNotPassedIn = !parameters

		return stateNameMatches
			&& (parametersWereNotPassedIn || Object.keys(parameters).every(key => parameters[key] === currentState.parameters[key]))
	}

	const renderer = makeRenderer(stateProviderEmitter)

	destroyDom = denodeify(renderer.destroy)
	getDomChild = denodeify(renderer.getChildElement)
	renderDom = denodeify(renderer.render)
	resetDom = denodeify(renderer.reset)

	return stateProviderEmitter
}

function getContentObject(stateResolveResultsObject, stateName) {
	const allPossibleResolvedStateNames = parse(stateName)

	return allPossibleResolvedStateNames
		.filter(stateName => stateResolveResultsObject[stateName])
		.reduce((obj, stateName) => {
			return extend(obj, stateResolveResultsObject[stateName])
		}, {})
}

function redirector(newStateName, parameters) {
	return {
		redirectTo: {
			name: newStateName,
			params: parameters,
		},
	}
}

// { [stateName]: resolveResult }
function resolveStates(states, parameters) {
	const statesWithResolveFunctions = states.filter(isFunction('resolve'))
	const stateNamesWithResolveFunctions = statesWithResolveFunctions.map(getProperty('name'))

	const resolves = Promise.all(statesWithResolveFunctions.map(state => {
		return new Promise((resolve, reject) => {
			const resolveCb = (err, content) => err ? reject(err) : resolve(content)

			resolveCb.redirect = (newStateName, parameters) => {
				reject(redirector(newStateName, parameters))
			}

			const res = state.resolve(state.data, parameters, resolveCb)
			if (isThenable(res)) {
				resolve(res)
			}
		})
	}))

	return resolves.then(resolveResults =>
		combine({
			stateName: stateNamesWithResolveFunctions,
			resolveResult: resolveResults,
		}).reduce((obj, result) => {
			obj[result.stateName] = result.resolveResult
			return obj
		}, {})
	)
}

},{"./default-router-options.js":1,"./lib/current-state":3,"./lib/extend.js":4,"./lib/promise-map-series":5,"./lib/state-change-logic":6,"./lib/state-comparison":7,"./lib/state-state":8,"./lib/state-string-parser":9,"./lib/state-transition-manager":10,"combine-arrays":11,"eventemitter3":12,"hash-brown-router":14,"iso-next-tick":16,"page-path-builder":18,"then-denodeify":23}],3:[function(require,module,exports){
module.exports = function CurrentState() {
	let current = {
		name: '',
		parameters: {},
	}

	return {
		get() {
			return current
		},
		set(name, parameters) {
			current = {
				name,
				parameters,
			}
		},
	}
}

},{}],4:[function(require,module,exports){
module.exports = (...args) => Object.assign({}, ...args)

},{}],5:[function(require,module,exports){
// Pulled from https://github.com/joliss/promise-map-series and prettied up a bit

module.exports = function sequence(array, iterator) {
	let currentPromise = Promise.resolve()
	return Promise.all(
		array.map((value, i) => {
			return currentPromise = currentPromise.then(() => iterator(value, i, array))
		})
	)
}

},{}],6:[function(require,module,exports){
module.exports = function stateChangeLogic(stateComparisonResults) {
	let hitChangingState = false
	let hitDestroyedState = false

	const output = {
		destroy: [],
		change: [],
		create: [],
	}

	stateComparisonResults.forEach(state => {
		hitChangingState = hitChangingState || state.stateParametersChanged
		hitDestroyedState = hitDestroyedState || state.stateNameChanged

		if (state.nameBefore) {
			if (hitDestroyedState) {
				output.destroy.push(state.nameBefore)
			} else if (hitChangingState) {
				output.change.push(state.nameBefore)
			}
		}

		if (state.nameAfter && hitDestroyedState) {
			output.create.push(state.nameAfter)
		}
	})

	return output
}

},{}],7:[function(require,module,exports){
const stateStringParser = require('./state-string-parser')
const extend = require('./extend.js')

const combine = require('combine-arrays')
const pathToRegexp = require('path-to-regexp-with-reversible-keys')

module.exports = function StateComparison(stateState) {
	const getPathParameters = pathParameters()

	const parametersChanged = args => parametersThatMatterWereChanged(extend(args, { stateState, getPathParameters }))

	return args => stateComparison(extend(args, { parametersChanged }))
}

function pathParameters() {
	const parameters = {}

	return path => {
		if (!path) {
			return []
		}

		if (!parameters[path]) {
			parameters[path] = pathToRegexp(path).keys.map(function(key) {
				return key.name
			})
		}

		return parameters[path]
	}
}

function parametersThatMatterWereChanged({ stateState, getPathParameters, stateName, fromParameters, toParameters }) {
	const state = stateState.get(stateName)
	const querystringParameters = state.querystringParameters || []
	const parameters = getPathParameters(state.route).concat(querystringParameters)

	return Array.isArray(parameters) && parameters.some(
		key => fromParameters[key] !== toParameters[key]
	)
}

function stateComparison({ parametersChanged, original, destination }) {
	const states = combine({
		start: stateStringParser(original.name),
		end: stateStringParser(destination.name),
	})

	return states.map(({ start, end }) => ({
		nameBefore: start,
		nameAfter: end,
		stateNameChanged: start !== end,
		stateParametersChanged: start === end && parametersChanged({
			stateName: start,
			fromParameters: original.parameters,
			toParameters: destination.parameters,
		}),
	}))
}

},{"./extend.js":4,"./state-string-parser":9,"combine-arrays":11,"path-to-regexp-with-reversible-keys":20}],8:[function(require,module,exports){
const stateStringParser = require('./state-string-parser')

module.exports = function StateState() {
	const states = {}

	function getHierarchy(name) {
		const names = stateStringParser(name)

		return names.map(name => {
			if (!states[name]) {
				throw new Error(`State ${name} not found`)
			}
			return states[name]
		})
	}

	function getParent(name) {
		const parentName = getParentName(name)

		return parentName && states[parentName]
	}

	function getParentName(name) {
		const names = stateStringParser(name)

		if (names.length > 1) {
			const secondToLast = names.length - 2

			return names[secondToLast]
		} else {
			return null
		}
	}

	function guaranteeAllStatesExist(newStateName) {
		const stateNames = stateStringParser(newStateName)
		const statesThatDontExist = stateNames.filter(name => !states[name])

		if (statesThatDontExist.length > 0) {
			throw new Error(`State ${statesThatDontExist[statesThatDontExist.length - 1]} does not exist`)
		}
	}

	function buildFullStateRoute(stateName) {
		return getHierarchy(stateName).map(state => `/${state.route || ''}`)
			.join('')
			.replace(/\/{2,}/g, '/')
	}

	function applyDefaultChildStates(stateName) {
		const state = states[stateName]

		const defaultChildStateName = state && (
			typeof state.defaultChild === 'function'
				? state.defaultChild()
				: state.defaultChild
		)

		if (!defaultChildStateName) {
			return stateName
		}

		const fullStateName = `${stateName}.${defaultChildStateName}`

		return applyDefaultChildStates(fullStateName)
	}


	return {
		add(name, state) {
			states[name] = state
		},
		get(name) {
			return name && states[name]
		},
		getHierarchy,
		getParent,
		getParentName,
		guaranteeAllStatesExist,
		buildFullStateRoute,
		applyDefaultChildStates,
	}
}

},{"./state-string-parser":9}],9:[function(require,module,exports){
module.exports = stateString => {
	return stateString.split('.').reduce((stateNames, latestNameChunk) => {
		stateNames.push(
			stateNames.length
				? stateNames[stateNames.length - 1] + '.' + latestNameChunk
				: latestNameChunk
		)

		return stateNames
	}, [])
}

},{}],10:[function(require,module,exports){
module.exports = emitter => {
	let currentTransitionAttempt = null
	let nextTransition = null

	function doneTransitioning() {
		currentTransitionAttempt = null
		if (nextTransition) {
			beginNextTransitionAttempt()
		}
	}

	const isTransitioning = () => !!currentTransitionAttempt

	function beginNextTransitionAttempt() {
		currentTransitionAttempt = nextTransition
		nextTransition = null
		currentTransitionAttempt.beginStateChange()
	}

	function cancelCurrentTransition() {
		currentTransitionAttempt.transition.cancelled = true
		const err = new Error('State transition cancelled by the state transition manager')
		err.wasCancelledBySomeoneElse = true
		emitter.emit('stateChangeCancelled', err)
	}

	emitter.on('stateChangeAttempt', beginStateChange => {
		nextTransition = createStateTransitionAttempt(beginStateChange)

		if (isTransitioning() && currentTransitionAttempt.transition.cancellable) {
			cancelCurrentTransition()
		} else if (!isTransitioning()) {
			beginNextTransitionAttempt()
		}
	})

	emitter.on('stateChangeError', doneTransitioning)
	emitter.on('stateChangeCancelled', doneTransitioning)
	emitter.on('stateChangeEnd', doneTransitioning)

	function createStateTransitionAttempt(beginStateChange) {
		const transition = {
			cancelled: false,
			cancellable: true,
		}
		return {
			transition,
			beginStateChange: (...args) => beginStateChange(transition, ...args),
		}
	}
}

},{}],11:[function(require,module,exports){
module.exports = function(obj) {
	var keys = Object.keys(obj)

	keys.forEach(function(key) {
		if (!Array.isArray(obj[key])) {
			throw new Error(key + ' is not an array')
		}
	})

	var maxIndex = keys.reduce(function(maxSoFar, key) {
		var len = obj[key].length
		return maxSoFar > len ? maxSoFar : len
	}, 0)

	var output = []

	function getObject(index) {
		var o = {}
		keys.forEach(function(key) {
			o[key] = obj[key][index]
		})
		return o
	}

	for (var i = 0; i < maxIndex; ++i) {
		output.push(getObject(i))
	}

	return output
}

},{}],12:[function(require,module,exports){
'use strict';

var has = Object.prototype.hasOwnProperty
  , prefix = '~';

/**
 * Constructor to create a storage for our `EE` objects.
 * An `Events` instance is a plain object whose properties are event names.
 *
 * @constructor
 * @api private
 */
function Events() {}

//
// We try to not inherit from `Object.prototype`. In some engines creating an
// instance in this way is faster than calling `Object.create(null)` directly.
// If `Object.create(null)` is not supported we prefix the event names with a
// character to make sure that the built-in object properties are not
// overridden or used as an attack vector.
//
if (Object.create) {
  Events.prototype = Object.create(null);

  //
  // This hack is needed because the `__proto__` property is still inherited in
  // some old browsers like Android 4, iPhone 5.1, Opera 11 and Safari 5.
  //
  if (!new Events().__proto__) prefix = false;
}

/**
 * Representation of a single event listener.
 *
 * @param {Function} fn The listener function.
 * @param {Mixed} context The context to invoke the listener with.
 * @param {Boolean} [once=false] Specify if the listener is a one-time listener.
 * @constructor
 * @api private
 */
function EE(fn, context, once) {
  this.fn = fn;
  this.context = context;
  this.once = once || false;
}

/**
 * Minimal `EventEmitter` interface that is molded against the Node.js
 * `EventEmitter` interface.
 *
 * @constructor
 * @api public
 */
function EventEmitter() {
  this._events = new Events();
  this._eventsCount = 0;
}

/**
 * Return an array listing the events for which the emitter has registered
 * listeners.
 *
 * @returns {Array}
 * @api public
 */
EventEmitter.prototype.eventNames = function eventNames() {
  var names = []
    , events
    , name;

  if (this._eventsCount === 0) return names;

  for (name in (events = this._events)) {
    if (has.call(events, name)) names.push(prefix ? name.slice(1) : name);
  }

  if (Object.getOwnPropertySymbols) {
    return names.concat(Object.getOwnPropertySymbols(events));
  }

  return names;
};

/**
 * Return the listeners registered for a given event.
 *
 * @param {String|Symbol} event The event name.
 * @param {Boolean} exists Only check if there are listeners.
 * @returns {Array|Boolean}
 * @api public
 */
EventEmitter.prototype.listeners = function listeners(event, exists) {
  var evt = prefix ? prefix + event : event
    , available = this._events[evt];

  if (exists) return !!available;
  if (!available) return [];
  if (available.fn) return [available.fn];

  for (var i = 0, l = available.length, ee = new Array(l); i < l; i++) {
    ee[i] = available[i].fn;
  }

  return ee;
};

/**
 * Calls each of the listeners registered for a given event.
 *
 * @param {String|Symbol} event The event name.
 * @returns {Boolean} `true` if the event had listeners, else `false`.
 * @api public
 */
EventEmitter.prototype.emit = function emit(event, a1, a2, a3, a4, a5) {
  var evt = prefix ? prefix + event : event;

  if (!this._events[evt]) return false;

  var listeners = this._events[evt]
    , len = arguments.length
    , args
    , i;

  if (listeners.fn) {
    if (listeners.once) this.removeListener(event, listeners.fn, undefined, true);

    switch (len) {
      case 1: return listeners.fn.call(listeners.context), true;
      case 2: return listeners.fn.call(listeners.context, a1), true;
      case 3: return listeners.fn.call(listeners.context, a1, a2), true;
      case 4: return listeners.fn.call(listeners.context, a1, a2, a3), true;
      case 5: return listeners.fn.call(listeners.context, a1, a2, a3, a4), true;
      case 6: return listeners.fn.call(listeners.context, a1, a2, a3, a4, a5), true;
    }

    for (i = 1, args = new Array(len -1); i < len; i++) {
      args[i - 1] = arguments[i];
    }

    listeners.fn.apply(listeners.context, args);
  } else {
    var length = listeners.length
      , j;

    for (i = 0; i < length; i++) {
      if (listeners[i].once) this.removeListener(event, listeners[i].fn, undefined, true);

      switch (len) {
        case 1: listeners[i].fn.call(listeners[i].context); break;
        case 2: listeners[i].fn.call(listeners[i].context, a1); break;
        case 3: listeners[i].fn.call(listeners[i].context, a1, a2); break;
        case 4: listeners[i].fn.call(listeners[i].context, a1, a2, a3); break;
        default:
          if (!args) for (j = 1, args = new Array(len -1); j < len; j++) {
            args[j - 1] = arguments[j];
          }

          listeners[i].fn.apply(listeners[i].context, args);
      }
    }
  }

  return true;
};

/**
 * Add a listener for a given event.
 *
 * @param {String|Symbol} event The event name.
 * @param {Function} fn The listener function.
 * @param {Mixed} [context=this] The context to invoke the listener with.
 * @returns {EventEmitter} `this`.
 * @api public
 */
EventEmitter.prototype.on = function on(event, fn, context) {
  var listener = new EE(fn, context || this)
    , evt = prefix ? prefix + event : event;

  if (!this._events[evt]) this._events[evt] = listener, this._eventsCount++;
  else if (!this._events[evt].fn) this._events[evt].push(listener);
  else this._events[evt] = [this._events[evt], listener];

  return this;
};

/**
 * Add a one-time listener for a given event.
 *
 * @param {String|Symbol} event The event name.
 * @param {Function} fn The listener function.
 * @param {Mixed} [context=this] The context to invoke the listener with.
 * @returns {EventEmitter} `this`.
 * @api public
 */
EventEmitter.prototype.once = function once(event, fn, context) {
  var listener = new EE(fn, context || this, true)
    , evt = prefix ? prefix + event : event;

  if (!this._events[evt]) this._events[evt] = listener, this._eventsCount++;
  else if (!this._events[evt].fn) this._events[evt].push(listener);
  else this._events[evt] = [this._events[evt], listener];

  return this;
};

/**
 * Remove the listeners of a given event.
 *
 * @param {String|Symbol} event The event name.
 * @param {Function} fn Only remove the listeners that match this function.
 * @param {Mixed} context Only remove the listeners that have this context.
 * @param {Boolean} once Only remove one-time listeners.
 * @returns {EventEmitter} `this`.
 * @api public
 */
EventEmitter.prototype.removeListener = function removeListener(event, fn, context, once) {
  var evt = prefix ? prefix + event : event;

  if (!this._events[evt]) return this;
  if (!fn) {
    if (--this._eventsCount === 0) this._events = new Events();
    else delete this._events[evt];
    return this;
  }

  var listeners = this._events[evt];

  if (listeners.fn) {
    if (
         listeners.fn === fn
      && (!once || listeners.once)
      && (!context || listeners.context === context)
    ) {
      if (--this._eventsCount === 0) this._events = new Events();
      else delete this._events[evt];
    }
  } else {
    for (var i = 0, events = [], length = listeners.length; i < length; i++) {
      if (
           listeners[i].fn !== fn
        || (once && !listeners[i].once)
        || (context && listeners[i].context !== context)
      ) {
        events.push(listeners[i]);
      }
    }

    //
    // Reset the array, or remove it completely if we have no more listeners.
    //
    if (events.length) this._events[evt] = events.length === 1 ? events[0] : events;
    else if (--this._eventsCount === 0) this._events = new Events();
    else delete this._events[evt];
  }

  return this;
};

/**
 * Remove all listeners, or those of the specified event.
 *
 * @param {String|Symbol} [event] The event name.
 * @returns {EventEmitter} `this`.
 * @api public
 */
EventEmitter.prototype.removeAllListeners = function removeAllListeners(event) {
  var evt;

  if (event) {
    evt = prefix ? prefix + event : event;
    if (this._events[evt]) {
      if (--this._eventsCount === 0) this._events = new Events();
      else delete this._events[evt];
    }
  } else {
    this._events = new Events();
    this._eventsCount = 0;
  }

  return this;
};

//
// Alias methods names because people roll like that.
//
EventEmitter.prototype.off = EventEmitter.prototype.removeListener;
EventEmitter.prototype.addListener = EventEmitter.prototype.on;

//
// This function doesn't apply anymore.
//
EventEmitter.prototype.setMaxListeners = function setMaxListeners() {
  return this;
};

//
// Expose the prefix.
//
EventEmitter.prefixed = prefix;

//
// Allow `EventEmitter` to be imported as module namespace.
//
EventEmitter.EventEmitter = EventEmitter;

//
// Expose the module.
//
if ('undefined' !== typeof module) {
  module.exports = EventEmitter;
}

},{}],13:[function(require,module,exports){
var EventEmitter = require('eventemitter3')

module.exports = function HashLocation(window) {
	var emitter = new EventEmitter()
	var last = ''
	var needToDecode = getNeedToDecode()

	window.addEventListener('hashchange', function() {
		if (last !== emitter.get()) {
			last = emitter.get()
			emitter.emit('hashchange')
		}

	})

	function ifRouteIsDifferent(actualNavigateFunction) {
		return function navigate(newPath) {
			if (newPath !== last) {
				actualNavigateFunction(window, newPath)
			}
		}
	}

	emitter.go = ifRouteIsDifferent(go)
	emitter.replace = ifRouteIsDifferent(replace)
	emitter.get = get.bind(null, window, needToDecode)

	return emitter
}

function replace(window, newPath) {
	window.location.replace(everythingBeforeTheSlash(window.location.href) + '#' + newPath)
}

function everythingBeforeTheSlash(url) {
	var hashIndex = url.indexOf('#')
	return hashIndex === -1 ? url : url.substring(0, hashIndex)
}

function go(window, newPath) {
	window.location.hash = newPath
}

function get(window, needToDecode) {
	var hash = removeHashFromPath(window.location.hash)
	return needToDecode ? decodeURI(hash) : hash
}

function removeHashFromPath(path) {
	return (path && path[0] === '#') ? path.substr(1) : path
}

function getNeedToDecode() {
	var a = document.createElement('a')
	a.href = '#x x'
	return !/x x/.test(a.hash)
}

},{"eventemitter3":12}],14:[function(require,module,exports){
var pathToRegexp = require('path-to-regexp-with-reversible-keys')
var qs = require('query-string')
var xtend = require('xtend')
var browserHashLocation = require('./hash-location.js')
var EventEmitter = require('eventemitter3')

module.exports = function Router(opts, hashLocation) {
	var emitter = new EventEmitter()
	if (isHashLocation(opts)) {
		hashLocation = opts
		opts = null
	}

	opts = opts || {}

	if (!hashLocation) {
		hashLocation = browserHashLocation(window)
	}

	function onNotFound(path, queryStringParameters) {
		emitter.emit('not found', path, queryStringParameters)
	}

	var routes = []

	var onHashChange = evaluateCurrentPath.bind(null, routes, hashLocation, !!opts.reverse, onNotFound)

	hashLocation.on('hashchange', onHashChange)

	function stop() {
		hashLocation.removeListener('hashchange', onHashChange)
	}

	emitter.add = add.bind(null, routes)
	emitter.stop = stop
	emitter.evaluateCurrent = evaluateCurrentPathOrGoToDefault.bind(null, routes, hashLocation, !!opts.reverse, onNotFound)
	emitter.replace = hashLocation.replace
	emitter.go = hashLocation.go
	emitter.location = hashLocation

	return emitter
}

function evaluateCurrentPath(routes, hashLocation, reverse, onNotFound) {
	evaluatePath(routes, stripHashFragment(hashLocation.get()), reverse, onNotFound)
}

function getPathParts(path) {
	var chunks = path.split('?')
	return {
		path: chunks.shift(),
		queryString: qs.parse(chunks.join('')),
	}
}

function evaluatePath(routes, path, reverse, onNotFound) {
	var pathParts = getPathParts(path)
	path = pathParts.path
	var queryStringParameters = pathParts.queryString

	var matchingRoute = find((reverse ? reverseArray(routes) : routes), path)

	if (matchingRoute) {
		var regexResult = matchingRoute.exec(path)
		var routeParameters = makeParametersObjectFromRegexResult(matchingRoute.keys, regexResult)
		var params = xtend(queryStringParameters, routeParameters)
		matchingRoute.fn(params)
	} else {
		onNotFound(path, queryStringParameters)
	}
}

function reverseArray(ary) {
	return ary.slice().reverse()
}

function makeParametersObjectFromRegexResult(keys, regexResult) {
	return keys.reduce(function(memo, urlKey, index) {
		memo[urlKey.name] = regexResult[index + 1]
		return memo
	}, {})
}

function add(routes, routeString, routeFunction) {
	if (typeof routeFunction !== 'function') {
		throw new Error('The router add function must be passed a callback function')
	}
	var newRoute = pathToRegexp(routeString)
	newRoute.fn = routeFunction
	routes.push(newRoute)
}

function evaluateCurrentPathOrGoToDefault(routes, hashLocation, reverse, onNotFound, defaultPath) {
	var currentLocation = stripHashFragment(hashLocation.get())
	var canUseCurrentLocation = currentLocation && (currentLocation !== '/' || defaultPath === '/')

	if (canUseCurrentLocation) {
		var routesCopy = routes.slice()
		evaluateCurrentPath(routesCopy, hashLocation, reverse, onNotFound)
	} else {
		hashLocation.go(defaultPath)
	}
}

var urlWithoutHashFragmentRegex = /^([^#]*)(:?#.*)?$/
function stripHashFragment(url) {
	var match = url.match(urlWithoutHashFragmentRegex)
	return match ? match[1] : ''
}

function isHashLocation(hashLocation) {
	return hashLocation && hashLocation.go && hashLocation.replace && hashLocation.on
}

function find(aryOfRegexes, str) {
	for (var i = 0; i < aryOfRegexes.length; ++i) {
		if (str.match(aryOfRegexes[i])) {
			return aryOfRegexes[i]
		}
	}
}

},{"./hash-location.js":13,"eventemitter3":12,"path-to-regexp-with-reversible-keys":20,"query-string":21,"xtend":24}],15:[function(require,module,exports){
module.exports = Array.isArray || function (arr) {
  return Object.prototype.toString.call(arr) == '[object Array]';
};

},{}],16:[function(require,module,exports){
module.exports = function (fn) {
  typeof setImmediate === 'function' ?
    setImmediate(fn) :
    setTimeout(fn, 0)
}

},{}],17:[function(require,module,exports){
/*
object-assign
(c) Sindre Sorhus
@license MIT
*/

'use strict';
/* eslint-disable no-unused-vars */
var getOwnPropertySymbols = Object.getOwnPropertySymbols;
var hasOwnProperty = Object.prototype.hasOwnProperty;
var propIsEnumerable = Object.prototype.propertyIsEnumerable;

function toObject(val) {
	if (val === null || val === undefined) {
		throw new TypeError('Object.assign cannot be called with null or undefined');
	}

	return Object(val);
}

function shouldUseNative() {
	try {
		if (!Object.assign) {
			return false;
		}

		// Detect buggy property enumeration order in older V8 versions.

		// https://bugs.chromium.org/p/v8/issues/detail?id=4118
		var test1 = new String('abc');  // eslint-disable-line no-new-wrappers
		test1[5] = 'de';
		if (Object.getOwnPropertyNames(test1)[0] === '5') {
			return false;
		}

		// https://bugs.chromium.org/p/v8/issues/detail?id=3056
		var test2 = {};
		for (var i = 0; i < 10; i++) {
			test2['_' + String.fromCharCode(i)] = i;
		}
		var order2 = Object.getOwnPropertyNames(test2).map(function (n) {
			return test2[n];
		});
		if (order2.join('') !== '0123456789') {
			return false;
		}

		// https://bugs.chromium.org/p/v8/issues/detail?id=3056
		var test3 = {};
		'abcdefghijklmnopqrst'.split('').forEach(function (letter) {
			test3[letter] = letter;
		});
		if (Object.keys(Object.assign({}, test3)).join('') !==
				'abcdefghijklmnopqrst') {
			return false;
		}

		return true;
	} catch (err) {
		// We don't expect any of the above to throw, but better to be safe.
		return false;
	}
}

module.exports = shouldUseNative() ? Object.assign : function (target, source) {
	var from;
	var to = toObject(target);
	var symbols;

	for (var s = 1; s < arguments.length; s++) {
		from = Object(arguments[s]);

		for (var key in from) {
			if (hasOwnProperty.call(from, key)) {
				to[key] = from[key];
			}
		}

		if (getOwnPropertySymbols) {
			symbols = getOwnPropertySymbols(from);
			for (var i = 0; i < symbols.length; i++) {
				if (propIsEnumerable.call(from, symbols[i])) {
					to[symbols[i]] = from[symbols[i]];
				}
			}
		}
	}

	return to;
};

},{}],18:[function(require,module,exports){
var parser = require('./path-parser')
var stringifyQuerystring = require('query-string').stringify

module.exports = function(pathStr, parameters) {
	var parsed = typeof pathStr === 'string' ? parser(pathStr) : pathStr
	var allTokens = parsed.allTokens
	var regex = parsed.regex

	if (parameters) {
		var path = allTokens.map(function(bit) {
			if (bit.string) {
				return bit.string
			}

			var defined = typeof parameters[bit.name] !== 'undefined'
			if (!bit.optional && !defined) {
				throw new Error('Must supply argument ' + bit.name + ' for path ' + pathStr)
			}

			return defined ? (bit.delimiter + encodeURIComponent(parameters[bit.name])) : ''
		}).join('')

		if (!regex.test(path)) {
			throw new Error('Provided arguments do not match the original arguments')
		}

		return buildPathWithQuerystring(path, parameters, allTokens)
	} else {
		return parsed
	}
}

function buildPathWithQuerystring(path, parameters, tokenArray) {
	var parametersInQuerystring = getParametersWithoutMatchingToken(parameters, tokenArray)

	if (Object.keys(parametersInQuerystring).length === 0) {
		return path
	}

	return path + '?' + stringifyQuerystring(parametersInQuerystring)
}

function getParametersWithoutMatchingToken(parameters, tokenArray) {
	var tokenHash = tokenArray.reduce(function(memo, bit) {
		if (!bit.string) {
			memo[bit.name] = bit
		}
		return memo
	}, {})

	return Object.keys(parameters).filter(function(param) {
		return !tokenHash[param]
	}).reduce(function(newParameters, param) {
		newParameters[param] = parameters[param]
		return newParameters
	}, {})
}

},{"./path-parser":19,"query-string":21}],19:[function(require,module,exports){
// This file to be replaced with an official implementation maintained by
// the page.js crew if and when that becomes an option

var pathToRegexp = require('path-to-regexp-with-reversible-keys')

module.exports = function(pathString) {
	var parseResults = pathToRegexp(pathString)

	// The only reason I'm returning a new object instead of the results of the pathToRegexp
	// function is so that if the official implementation ends up returning an
	// allTokens-style array via some other mechanism, I may be able to change this file
	// without having to change the rest of the module in index.js
	return {
		regex: parseResults,
		allTokens: parseResults.allTokens
	}
}

},{"path-to-regexp-with-reversible-keys":20}],20:[function(require,module,exports){
var isArray = require('isarray');

/**
 * Expose `pathToRegexp`.
 */
module.exports = pathToRegexp;

/**
 * The main path matching regexp utility.
 *
 * @type {RegExp}
 */
var PATH_REGEXP = new RegExp([
  // Match escaped characters that would otherwise appear in future matches.
  // This allows the user to escape special characters that won't transform.
  '(\\\\.)',
  // Match Express-style parameters and un-named parameters with a prefix
  // and optional suffixes. Matches appear as:
  //
  // "/:test(\\d+)?" => ["/", "test", "\d+", undefined, "?"]
  // "/route(\\d+)" => [undefined, undefined, undefined, "\d+", undefined]
  '([\\/.])?(?:\\:(\\w+)(?:\\(((?:\\\\.|[^)])*)\\))?|\\(((?:\\\\.|[^)])*)\\))([+*?])?',
  // Match regexp special characters that are always escaped.
  '([.+*?=^!:${}()[\\]|\\/])'
].join('|'), 'g');

/**
 * Escape the capturing group by escaping special characters and meaning.
 *
 * @param  {String} group
 * @return {String}
 */
function escapeGroup (group) {
  return group.replace(/([=!:$\/()])/g, '\\$1');
}

/**
 * Attach the keys as a property of the regexp.
 *
 * @param  {RegExp} re
 * @param  {Array}  keys
 * @return {RegExp}
 */
function attachKeys (re, keys, allTokens) {
  re.keys = keys;
  re.allTokens = allTokens;
  return re;
}

/**
 * Get the flags for a regexp from the options.
 *
 * @param  {Object} options
 * @return {String}
 */
function flags (options) {
  return options.sensitive ? '' : 'i';
}

/**
 * Pull out keys from a regexp.
 *
 * @param  {RegExp} path
 * @param  {Array}  keys
 * @return {RegExp}
 */
function regexpToRegexp (path, keys, allTokens) {
  // Use a negative lookahead to match only capturing groups.
  var groups = path.source.match(/\((?!\?)/g);

  if (groups) {
    for (var i = 0; i < groups.length; i++) {
      keys.push({
        name:      i,
        delimiter: null,
        optional:  false,
        repeat:    false
      });
    }
  }

  return attachKeys(path, keys, allTokens);
}

/**
 * Transform an array into a regexp.
 *
 * @param  {Array}  path
 * @param  {Array}  keys
 * @param  {Object} options
 * @return {RegExp}
 */
function arrayToRegexp (path, keys, options, allTokens) {
  var parts = [];

  for (var i = 0; i < path.length; i++) {
    parts.push(pathToRegexp(path[i], keys, options, allTokens).source);
  }

  var regexp = new RegExp('(?:' + parts.join('|') + ')', flags(options));
  return attachKeys(regexp, keys, allTokens);
}

/**
 * Replace the specific tags with regexp strings.
 *
 * @param  {String} path
 * @param  {Array}  keys
 * @return {String}
 */
function replacePath (path, keys, allTokens) {
  var index = 0;
  var lastEndIndex = 0

  function addLastToken(lastToken) {
    if (lastEndIndex === 0 && lastToken[0] !== '/') {
      lastToken = '/' + lastToken
    }
    allTokens.push({
      string: lastToken
    });
  }


  function replace (match, escaped, prefix, key, capture, group, suffix, escape, offset) {
    if (escaped) {
      return escaped;
    }

    if (escape) {
      return '\\' + escape;
    }

    var repeat   = suffix === '+' || suffix === '*';
    var optional = suffix === '?' || suffix === '*';

    if (offset > lastEndIndex) {
      addLastToken(path.substring(lastEndIndex, offset));
    }

    lastEndIndex = offset + match.length;

    var newKey = {
      name:      key || index++,
      delimiter: prefix || '/',
      optional:  optional,
      repeat:    repeat
    }

    keys.push(newKey);
    allTokens.push(newKey);

    prefix = prefix ? ('\\' + prefix) : '';
    capture = escapeGroup(capture || group || '[^' + (prefix || '\\/') + ']+?');

    if (repeat) {
      capture = capture + '(?:' + prefix + capture + ')*';
    }

    if (optional) {
      return '(?:' + prefix + '(' + capture + '))?';
    }

    // Basic parameter support.
    return prefix + '(' + capture + ')';
  }

  var newPath = path.replace(PATH_REGEXP, replace);

  if (lastEndIndex < path.length) {
    addLastToken(path.substring(lastEndIndex))
  }

  return newPath;
}

/**
 * Normalize the given path string, returning a regular expression.
 *
 * An empty array can be passed in for the keys, which will hold the
 * placeholder key descriptions. For example, using `/user/:id`, `keys` will
 * contain `[{ name: 'id', delimiter: '/', optional: false, repeat: false }]`.
 *
 * @param  {(String|RegExp|Array)} path
 * @param  {Array}                 [keys]
 * @param  {Object}                [options]
 * @return {RegExp}
 */
function pathToRegexp (path, keys, options, allTokens) {
  keys = keys || [];
  allTokens = allTokens || [];

  if (!isArray(keys)) {
    options = keys;
    keys = [];
  } else if (!options) {
    options = {};
  }

  if (path instanceof RegExp) {
    return regexpToRegexp(path, keys, options, allTokens);
  }

  if (isArray(path)) {
    return arrayToRegexp(path, keys, options, allTokens);
  }

  var strict = options.strict;
  var end = options.end !== false;
  var route = replacePath(path, keys, allTokens);
  var endsWithSlash = path.charAt(path.length - 1) === '/';

  // In non-strict mode we allow a slash at the end of match. If the path to
  // match already ends with a slash, we remove it for consistency. The slash
  // is valid at the end of a path match, not in the middle. This is important
  // in non-ending mode, where "/test/" shouldn't match "/test//route".
  if (!strict) {
    route = (endsWithSlash ? route.slice(0, -2) : route) + '(?:\\/(?=$))?';
  }

  if (end) {
    route += '$';
  } else {
    // In non-ending mode, we need the capturing groups to match as much as
    // possible by using a positive lookahead to the end or next path segment.
    route += strict && endsWithSlash ? '' : '(?=\\/|$)';
  }

  return attachKeys(new RegExp('^' + route, flags(options)), keys, allTokens);
}

},{"isarray":15}],21:[function(require,module,exports){
'use strict';
var strictUriEncode = require('strict-uri-encode');
var objectAssign = require('object-assign');

function encoderForArrayFormat(opts) {
	switch (opts.arrayFormat) {
		case 'index':
			return function (key, value, index) {
				return value === null ? [
					encode(key, opts),
					'[',
					index,
					']'
				].join('') : [
					encode(key, opts),
					'[',
					encode(index, opts),
					']=',
					encode(value, opts)
				].join('');
			};

		case 'bracket':
			return function (key, value) {
				return value === null ? encode(key, opts) : [
					encode(key, opts),
					'[]=',
					encode(value, opts)
				].join('');
			};

		default:
			return function (key, value) {
				return value === null ? encode(key, opts) : [
					encode(key, opts),
					'=',
					encode(value, opts)
				].join('');
			};
	}
}

function parserForArrayFormat(opts) {
	var result;

	switch (opts.arrayFormat) {
		case 'index':
			return function (key, value, accumulator) {
				result = /\[(\d*)\]$/.exec(key);

				key = key.replace(/\[\d*\]$/, '');

				if (!result) {
					accumulator[key] = value;
					return;
				}

				if (accumulator[key] === undefined) {
					accumulator[key] = {};
				}

				accumulator[key][result[1]] = value;
			};

		case 'bracket':
			return function (key, value, accumulator) {
				result = /(\[\])$/.exec(key);
				key = key.replace(/\[\]$/, '');

				if (!result) {
					accumulator[key] = value;
					return;
				} else if (accumulator[key] === undefined) {
					accumulator[key] = [value];
					return;
				}

				accumulator[key] = [].concat(accumulator[key], value);
			};

		default:
			return function (key, value, accumulator) {
				if (accumulator[key] === undefined) {
					accumulator[key] = value;
					return;
				}

				accumulator[key] = [].concat(accumulator[key], value);
			};
	}
}

function encode(value, opts) {
	if (opts.encode) {
		return opts.strict ? strictUriEncode(value) : encodeURIComponent(value);
	}

	return value;
}

function keysSorter(input) {
	if (Array.isArray(input)) {
		return input.sort();
	} else if (typeof input === 'object') {
		return keysSorter(Object.keys(input)).sort(function (a, b) {
			return Number(a) - Number(b);
		}).map(function (key) {
			return input[key];
		});
	}

	return input;
}

exports.extract = function (str) {
	return str.split('?')[1] || '';
};

exports.parse = function (str, opts) {
	opts = objectAssign({arrayFormat: 'none'}, opts);

	var formatter = parserForArrayFormat(opts);

	// Create an object with no prototype
	// https://github.com/sindresorhus/query-string/issues/47
	var ret = Object.create(null);

	if (typeof str !== 'string') {
		return ret;
	}

	str = str.trim().replace(/^(\?|#|&)/, '');

	if (!str) {
		return ret;
	}

	str.split('&').forEach(function (param) {
		var parts = param.replace(/\+/g, ' ').split('=');
		// Firefox (pre 40) decodes `%3D` to `=`
		// https://github.com/sindresorhus/query-string/pull/37
		var key = parts.shift();
		var val = parts.length > 0 ? parts.join('=') : undefined;

		// missing `=` should be `null`:
		// http://w3.org/TR/2012/WD-url-20120524/#collect-url-parameters
		val = val === undefined ? null : decodeURIComponent(val);

		formatter(decodeURIComponent(key), val, ret);
	});

	return Object.keys(ret).sort().reduce(function (result, key) {
		var val = ret[key];
		if (Boolean(val) && typeof val === 'object' && !Array.isArray(val)) {
			// Sort object keys, not values
			result[key] = keysSorter(val);
		} else {
			result[key] = val;
		}

		return result;
	}, Object.create(null));
};

exports.stringify = function (obj, opts) {
	var defaults = {
		encode: true,
		strict: true,
		arrayFormat: 'none'
	};

	opts = objectAssign(defaults, opts);

	var formatter = encoderForArrayFormat(opts);

	return obj ? Object.keys(obj).sort().map(function (key) {
		var val = obj[key];

		if (val === undefined) {
			return '';
		}

		if (val === null) {
			return encode(key, opts);
		}

		if (Array.isArray(val)) {
			var result = [];

			val.slice().forEach(function (val2) {
				if (val2 === undefined) {
					return;
				}

				result.push(formatter(key, val2, result.length));
			});

			return result.join('&');
		}

		return encode(key, opts) + '=' + encode(val, opts);
	}).filter(function (x) {
		return x.length > 0;
	}).join('&') : '';
};

},{"object-assign":17,"strict-uri-encode":22}],22:[function(require,module,exports){
'use strict';
module.exports = function (str) {
	return encodeURIComponent(str).replace(/[!'()*]/g, function (c) {
		return '%' + c.charCodeAt(0).toString(16).toUpperCase();
	});
};

},{}],23:[function(require,module,exports){
module.exports = function denodeify(fn) {
	return function() {
		var self = this
		var args = Array.prototype.slice.call(arguments)
		return new Promise(function(resolve, reject) {
			args.push(function(err, res) {
				if (err) {
					reject(err)
				} else {
					resolve(res)
				}
			})

			var res = fn.apply(self, args)

			var isPromise = res
				&& (typeof res === 'object' || typeof res === 'function')
				&& typeof res.then === 'function'

			if (isPromise) {
				resolve(res)
			}
		})
	}
}

},{}],24:[function(require,module,exports){
module.exports = extend

var hasOwnProperty = Object.prototype.hasOwnProperty;

function extend() {
    var target = {}

    for (var i = 0; i < arguments.length; i++) {
        var source = arguments[i]

        for (var key in source) {
            if (hasOwnProperty.call(source, key)) {
                target[key] = source[key]
            }
        }
    }

    return target
}

},{}]},{},[2])(2)
});