import { expect, test } from "bun:test";
import { arrangeBar, setFor } from "./lounge-score.ts";

test("the blues reaches its turnaround and starts the next twelve-bar chorus on the tonic", () => {
  const set = setFor(23);
  const roots = Array.from({ length: 13 }, (_, n) => {
    const bass = arrangeBar(set, n).find((hit) => hit.voice === "bass" && hit.beat === 0);
    if (bass?.voice !== "bass") throw Error("missing bass downbeat");
    return (bass.midi - set.key) % 12;
  });
  expect(roots).toEqual([0, 0, 0, 0, 5, 5, 0, 0, 7, 5, 0, 7, 0]);
});

test("ballad, bossa and swing have different bass phrasing", () => {
  const pulse = (hour: number) => arrangeBar(setFor(hour), 0).filter((hit) => hit.voice === "bass").map((hit) => hit.beat);
  expect(pulse(2)).toEqual([0, 2]);
  expect(pulse(15)).toEqual([0, 1.5, 2]);
  expect(pulse(19)).toEqual([0, 1, 2, 3]);
});

test("the head returns after the solo and a listener joining mid-chorus gets the same phrase", () => {
  const set = setFor(19);
  const vibes = (n: number) => arrangeBar(set, n).filter((hit) => hit.voice === "vibes");
  const head = vibes(0);
  expect(head.length).toBeGreaterThan(0);
  expect(vibes(2)).toHaveLength(0); // the piano answers
  expect(vibes(32)).not.toEqual(head);
  expect(vibes(64)).toEqual(head);
  const lateArrival = arrangeBar(setFor(set.hour), 38);
  for (let n = 0; n < 38; n++) arrangeBar(set, n);
  expect(arrangeBar(set, 38)).toEqual(lateArrival);
});

test("each hourly lineup plays only the instruments on its bandstand", () => {
  for (let hour = 0; hour < 24; hour++) {
    const set = setFor(hour);
    const phrase = Array.from({ length: 4 }, (_, n) => arrangeBar(set, n)).flat();
    const voices = new Set(phrase.map((hit) => hit.voice));
    expect(voices.has("bass")).toBe(true);
    expect(voices.has("piano")).toBe(set.piano);
    expect(voices.has("vibes")).toBe(set.vibes);
    expect(voices.has("brush")).toBe(set.ride);
    expect(voices.has("ride")).toBe(set.ride);
  }
});
