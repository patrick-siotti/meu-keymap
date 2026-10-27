import type { Profile, LightEffect } from "./model.ts";
import type { Condition } from "./conditions.ts";

export function eventInUse(
  profile: Profile,
  eventId: string,
  stateId?: string,
): boolean {
  const condition = (c: Condition): boolean =>
    c.kind === "test"
      ? c.source.kind === "event" &&
        c.source.eventId === eventId &&
        (!stateId || c.value === stateId)
      : c.children.some(condition);
  const light = (e: LightEffect) => condition(e.visibility);
  return (
    profile.layers.some((l) =>
      l.controls.some((c) =>
        c.rules.some(
          (r) =>
            condition(r.condition) ||
            [r.behavior, ...(r.otherwise ? [r.otherwise] : [])].some(
              (b) =>
                light(b.light.effect) ||
                (b.when.eventId === eventId &&
                  (!stateId || b.when.stateId === stateId)) ||
                (b.transition.eventId === eventId &&
                  (!stateId ||
                    (b.transition.operation === "set" &&
                      b.transition.stateId === stateId))),
            ),
        ),
      ),
    ) ||
    profile.events.some(
      (e) =>
        (!stateId ? e.id !== eventId : true) &&
        e.states.some(
          (s) =>
            condition(s.condition) ||
            [...s.lights, ...(s.otherwise?.lights ?? [])].some((l) =>
              light(l.effect),
            ),
        ),
    )
  );
}
