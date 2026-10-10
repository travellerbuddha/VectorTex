import { MockFlightConnector } from './flight';
import { MockHotelConnector } from './hotel';
import { fileMockState, memoryMockState } from './state';

/**
 * The MOCK hotel and flight connectors of a process. With a state folder (the local demo's MOCK_STATE_DIR) every
 * process using the same folder sees the same MOCK provider; without one the state is this process's memory.
 */
export function mockConnectors(stateDir?: string | null): { hotels: MockHotelConnector; flights: MockFlightConnector } {
  const state = stateDir && stateDir.trim() ? fileMockState(stateDir.trim()) : memoryMockState();
  return { hotels: new MockHotelConnector(state), flights: new MockFlightConnector(undefined, state) };
}
