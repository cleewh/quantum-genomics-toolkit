/**
 * Circuit Transpiler module
 * Converts abstract circuits to hardware-native gate sets while respecting topology constraints.
 */

export {
  CircuitTranspiler,
  AllToAllConnectivity,
  GridConnectivity,
  CustomConnectivity,
} from './circuit-transpiler.js';

export type {
  CircuitTranspilerInterface,
  ConnectivityGraph,
  ParsedGate,
  NativeGate,
} from './circuit-transpiler.js';
