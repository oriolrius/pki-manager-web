import { stateLabel, statePillClasses, stateTooltip, type HostKrlStateInfo } from './host-krl-state';

/** Distribution-state pill with the pinned honest tooltip (BLK-09). */
export function HostKrlStatePill({ state }: { state: HostKrlStateInfo }) {
  return (
    <span className={statePillClasses(state.state)} title={stateTooltip(state)}>
      {state.state !== 'unknown' && <span aria-hidden>● </span>}
      {stateLabel(state.state)}
      {state.unsignedLatest ? ' (unsigned)' : ''}
    </span>
  );
}
