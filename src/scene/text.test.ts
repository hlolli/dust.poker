import { expect, test } from "bun:test";
import { Label } from "./text.ts";

test("a label uploads only changed text or paint and skips fully blank planes", () => {
  let repaints = 0;
  const ctx = { clearRect: () => repaints++, fillText() {}, fillRect() {}, measureText: () => ({ width: 8 }) };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement: () => ({ getContext: () => ctx }),
  } });
  try {
    const label = new Label("Ada 200", { width: 0.5, color: "white" });
    const material = label.mesh.material;
    const style = { color: "gold", background: "black" };
    label.set("Ada 200", style);
    const painted = repaints, version = material.map!.version;
    label.set("Ada 200", { ...style });
    expect(repaints).toBe(painted);
    expect(material.map!.version).toBe(version);
    label.set("Ada 200");
    expect(material.map!.version).toBe(version + 1);
    label.set("");
    expect(material.visible).toBe(false);
    label.set("", { background: "black" });
    expect(material.visible).toBe(true);
    label.set("Ada 195");
    expect(material.visible).toBe(true);
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
