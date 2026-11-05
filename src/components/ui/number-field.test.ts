/**
 * Real render tests (react-dom/client + act, happy-dom) for the numeric text-draft input and its
 * five production call sites. Bug being guarded: emptying a numeric field wrote 0 and a leading
 * zero then stayed ("80" typed after clearing showed "080").
 */
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { NumberField } from "./number-field";
import { SupplementRow } from "@/components/minijob/JobDialog";
import { DEFAULT_SETTINGS, DEFAULT_SUPPLEMENTS, type Supplement } from "@/lib/minijob/types";
import { DEMO_SCOPE } from "@/lib/minijob/storage-scope";
import {
  activateScope,
  EMPTY_DATA,
  getData,
  loadFromStorage,
  replaceAll,
  updateSettings,
  useAppData,
} from "@/lib/minijob/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;

function input(): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>("input[type=number]");
  if (!el) throw new Error("number input not found");
  return el;
}
/** Sets the whole text like a paste / selection-replace does. */
function setText(text: string) {
  const el = input();
  act(() => {
    el.focus();
    setter.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
/** Types characters one by one, appending to the current text (no selection). */
function typeChars(chars: string) {
  for (const c of chars) setText(input().value + c);
}
function blur() {
  act(() => {
    input().focus();
    input().blur();
  });
}

function Harness({ initial, log }: { initial: number; log: number[] }) {
  const [v, setV] = useState(initial);
  return createElement(NumberField, {
    value: v,
    onValueChange: (n: number) => {
      log.push(n);
      setV(n);
    },
  });
}
function mount(initial: number) {
  const log: number[] = [];
  act(() => root.render(createElement(Harness, { initial, log })));
  return log;
}

describe("NumberField", () => {
  it("shows the stored number and a number type", () => {
    mount(100);
    expect(input().value).toBe("100");
    expect(input().type).toBe("number");
  });

  it("clearing the field leaves it EMPTY (not 0) and reports nothing", () => {
    const log = mount(100);
    setText("");
    expect(input().value).toBe("");
    expect(log).toEqual([]);
  });

  it("clear, then type 8, 0 -> 80 (no leading zero), reports numbers only", () => {
    const log = mount(100);
    setText("");
    typeChars("80");
    expect(input().value).toBe("80");
    expect(log).toEqual([8, 80]);
    blur();
    expect(input().value).toBe("80");
  });

  it.each([
    ["080", "80", 80],
    ["08", "8", 8],
    ["0080", "80", 80],
    ["0", "0", 0],
    ["100", "100", 100],
    ["250", "250", 250],
    ["12.5", "12.5", 12.5],
  ])("typed/pasted %j normalises to %j on blur (value %d, numeric)", (text, shown, num) => {
    const log = mount(50);
    setText(text);
    blur();
    expect(input().value).toBe(shown);
    expect(log.at(-1)).toBe(num);
    expect(typeof log.at(-1)).toBe("number");
  });

  it("while editing, a leading-zero draft may be visible; it is normalised on blur", () => {
    mount(100);
    setText("");
    typeChars("080");
    expect(input().value).toBe("080");
    blur();
    expect(input().value).toBe("80");
  });

  it("empty + blur restores the last valid value (never stores 0)", () => {
    const log = mount(80);
    setText("");
    blur();
    expect(input().value).toBe("80");
    expect(log).toEqual([]);
  });

  it("empty after a valid edit restores the value from focus start (snapshot), not the intermediate one", () => {
    const log = mount(100);
    setText("60");
    setText("");
    blur();
    expect(input().value).toBe("100");
    expect(log).toEqual([60, 100]);
  });

  it("0 is valid and persisted as the number 0", () => {
    const log = mount(50);
    setText("0");
    blur();
    expect(input().value).toBe("0");
    expect(log).toEqual([0]);
  });

  it("negative and garbage input is rejected; blur restores the last valid value", () => {
    const log = mount(80);
    for (const bad of ["-5", "-", "abc", "1e999"]) {
      setText(bad);
      blur();
      expect(input().value).toBe("80");
    }
    expect(log).toEqual([]);
  });

  it("no 100 % cap", () => {
    const log = mount(80);
    setText("250");
    blur();
    expect(log).toEqual([250]);
  });

  it("paste replaces the selection: 080 -> 80, 80 -> 80", () => {
    mount(5);
    setText("080");
    blur();
    expect(input().value).toBe("80");
    setText("80");
    blur();
    expect(input().value).toBe("80");
  });

  it("follows an external value change when not focused", () => {
    function Ext() {
      const [v, setV] = useState(10);
      return createElement(
        "div",
        null,
        createElement(NumberField, { value: v, onValueChange: setV }),
        createElement("button", { id: "set", onClick: () => setV(42) }),
      );
    }
    act(() => root.render(createElement(Ext)));
    act(() => container.querySelector<HTMLButtonElement>("#set")!.click());
    expect(input().value).toBe("42");
  });

  it("forwards props (disabled, className, inputMode) and calls the user's onBlur", () => {
    let blurred = 0;
    act(() =>
      root.render(
        createElement(NumberField, {
          value: 1,
          onValueChange: () => {},
          disabled: true,
          className: "x-test",
          inputMode: "decimal",
          onBlur: () => (blurred += 1),
        }),
      ),
    );
    expect(input().disabled).toBe(true);
    expect(input().className).toContain("x-test");
    expect(input().inputMode).toBe("decimal");
    act(() => {
      input().disabled = false;
    });
    blur();
    expect(blurred).toBe(1);
  });
});

/** Deletes the last character (Backspace at the end of the text). */
function backspace() {
  setText(input().value.slice(0, -1));
}
/** Parent state = initial value overwritten by every reported value. */
function parentValue(initial: number, log: number[]): number {
  return log.length ? (log[log.length - 1] ?? initial) : initial;
}

describe("NumberField: snapshot at focus start is restored when the draft is abandoned", () => {
  // Reported regression: "80" -> Backspace ("8") -> Backspace ("") -> blur showed 8 instead of 80.
  it("80, Backspace, Backspace, blur -> 80 (parent too); the live value 8 may be reported meanwhile", () => {
    const log = mount(80);
    backspace();
    expect(input().value).toBe("8");
    expect(parentValue(80, log)).toBe(8); // live commit of the valid intermediate value is allowed
    backspace();
    expect(input().value).toBe("");
    blur();
    expect(input().value).toBe("80");
    expect(parentValue(80, log)).toBe(80);
    expect(log).toEqual([8, 80]);
  });

  it.each([
    ["8 -> empty", ["8", ""], 80],
    ["0 -> empty", ["0", ""], 80],
    ["080 -> empty", ["080", ""], 80],
    ["empty only (select all + delete)", [""], 80],
    ["8 -> 0 -> empty", ["8", "0", ""], 80],
    ["abandon after a valid edit chain", ["70", "7", ""], 80],
  ])("start 80: %s -> blur restores 80 in input and parent", (_name, texts, want) => {
    const log = mount(80);
    for (const t of texts as string[]) setText(t);
    blur();
    expect(input().value).toBe(String(want));
    expect(parentValue(80, log)).toBe(want);
  });

  it("start 80: 0 -> 70 gives 70 (delete the 8 at the start, type 7 in front of the 0)", () => {
    const log = mount(80);
    setText("0");
    setText("70");
    blur();
    expect(input().value).toBe("70");
    expect(parentValue(80, log)).toBe(70);
  });

  it("start 80: 8 -> 7 gives 7 (the second digit really was replaced)", () => {
    const log = mount(80);
    setText("8");
    setText("7");
    blur();
    expect(input().value).toBe("7");
    expect(parentValue(80, log)).toBe(7);
  });

  it("start 80: no change -> 80, nothing reported", () => {
    const log = mount(80);
    act(() => input().focus());
    blur();
    expect(input().value).toBe("80");
    expect(log).toEqual([]);
  });

  it("start 0: delete everything -> 0 (0 stays valid), nothing reported", () => {
    const log = mount(0);
    setText("");
    blur();
    expect(input().value).toBe("0");
    expect(parentValue(0, log)).toBe(0);
    expect(log).toEqual([]);
  });

  it("start 0: 5 -> empty restores 0 (restore is reported)", () => {
    const log = mount(0);
    setText("5");
    setText("");
    blur();
    expect(input().value).toBe("0");
    expect(parentValue(0, log)).toBe(0);
  });

  it("negative / invalid draft after a live edit also restores the snapshot", () => {
    const log = mount(80);
    setText("8");
    setText("-5");
    blur();
    expect(input().value).toBe("80");
    expect(parentValue(80, log)).toBe(80);
  });

  it("the snapshot is renewed for each focus phase", () => {
    const log = mount(80);
    setText("60");
    blur();
    expect(parentValue(80, log)).toBe(60);
    setText("6");
    setText("");
    blur();
    expect(input().value).toBe("60"); // not 80: the new focus phase began at 60
    expect(parentValue(80, log)).toBe(60);
  });

  it("a valid draft is kept and normalised (no restore)", () => {
    const log = mount(80);
    setText("");
    setText("090");
    blur();
    expect(input().value).toBe("90");
    expect(parentValue(80, log)).toBe(90);
  });

  it("the snapshot is taken at focus start, not at the first change", () => {
    function Ext({ log }: { log: number[] }) {
      const [v, setV] = useState(80);
      return createElement(
        "div",
        null,
        createElement(NumberField, {
          value: v,
          onValueChange: (n: number) => {
            log.push(n);
            setV(n);
          },
        }),
        createElement("button", { id: "ext", onClick: () => setV(50) }),
      );
    }
    const log: number[] = [];
    act(() => root.render(createElement(Ext, { log })));
    act(() => input().focus()); // snapshot = 80
    act(() => container.querySelector<HTMLButtonElement>("#ext")!.click()); // external change to 50
    setText("");
    blur();
    expect(input().value).toBe("80");
    expect(log).toEqual([80]);
  });

  it("a change without a focus event (e.g. autofill) still gets a fresh snapshot per phase", () => {
    const log = mount(100);
    const fire = (type: string) =>
      act(() => input().dispatchEvent(new FocusEvent(type, { bubbles: true })));
    const edit = (text: string) =>
      act(() => {
        setter.call(input(), text);
        input().dispatchEvent(new Event("input", { bubbles: true }));
      });
    edit("60");
    fire("focusout"); // phase 1 ends: 60 committed
    expect(parentValue(100, log)).toBe(60);
    edit("6");
    edit("");
    fire("focusout"); // phase 2 began at 60 (not at the stale 100)
    expect(input().value).toBe("60");
    expect(parentValue(100, log)).toBe(60);
  });

  describe("unmount while focused (e.g. Radix tab switch unmounts before blur)", () => {
    function Tabs({ log, initial }: { log: number[]; initial: number }) {
      const [v, setV] = useState(initial);
      const [shown, setShown] = useState(true);
      return createElement(
        "div",
        null,
        shown
          ? createElement(NumberField, {
              value: v,
              onValueChange: (n: number) => {
                log.push(n);
                setV(n);
              },
            })
          : createElement("span", { id: "val" }, String(v)),
        createElement("button", { id: "hide", onClick: () => setShown(false) }),
      );
    }
    const hide = () => act(() => container.querySelector<HTMLButtonElement>("#hide")!.click());
    const shownValue = () => container.querySelector("#val")!.textContent;

    it("80 -> 8 -> empty, then unmount without blur: parent is 80", () => {
      const log: number[] = [];
      act(() => root.render(createElement(Tabs, { log, initial: 80 })));
      backspace();
      backspace();
      hide();
      expect(shownValue()).toBe("80");
      expect(log).toEqual([8, 80]);
    });

    it("a valid draft is kept on unmount (70 stays 70)", () => {
      const log: number[] = [];
      act(() => root.render(createElement(Tabs, { log, initial: 80 })));
      setText("70");
      hide();
      expect(shownValue()).toBe("70");
      expect(log).toEqual([70]);
    });

    it("select-all + delete, unmount: nothing reported, value stays", () => {
      const log: number[] = [];
      act(() => root.render(createElement(Tabs, { log, initial: 80 })));
      setText("");
      hide();
      expect(shownValue()).toBe("80");
      expect(log).toEqual([]);
    });

    it("after a normal blur the unmount does not restore anything again", () => {
      const log: number[] = [];
      act(() => root.render(createElement(Tabs, { log, initial: 80 })));
      setText("60");
      blur();
      hide();
      expect(shownValue()).toBe("60");
      expect(log).toEqual([60]);
    });

    it("never-focused field: unmount reports nothing", () => {
      const log: number[] = [];
      act(() => root.render(createElement(Tabs, { log, initial: 80 })));
      hide();
      expect(log).toEqual([]);
    });
  });

  it("forwards the user's onFocus", () => {
    let focused = 0;
    act(() =>
      root.render(
        createElement(NumberField, {
          value: 1,
          onValueChange: () => {},
          onFocus: () => (focused += 1),
        }),
      ),
    );
    act(() => input().focus());
    expect(focused).toBe(1);
  });
});

describe("SupplementRow (JobDialog tab + Einstellungen > Lohn)", () => {
  function Row({ log }: { log: Supplement[] }) {
    const [s, setS] = useState<Supplement>({ ...DEFAULT_SUPPLEMENTS.holiday, enabled: true });
    return createElement(SupplementRow, {
      label: "Feiertag",
      value: s,
      onChange: (n: Supplement) => {
        log.push(n);
        setS(n);
      },
    });
  }
  it("clear -> type 80 stores the NUMBER 80, keeps mode/enabled, shows 80", () => {
    const log: Supplement[] = [];
    act(() => root.render(createElement(Row, { log })));
    expect(input().value).toBe("100");
    setText("");
    expect(input().value).toBe("");
    expect(log).toEqual([]);
    typeChars("80");
    blur();
    expect(input().value).toBe("80");
    expect(log.at(-1)).toEqual({ enabled: true, mode: "prozent", value: 80 });
    expect(typeof log.at(-1)!.value).toBe("number");
  });
});

describe("persistence round trip (real store, Einstellungen > Lohn wiring)", () => {
  function Lohn() {
    const data = useAppData();
    return createElement(SupplementRow, {
      label: "Feiertag",
      value: data.settings.supplements.holiday,
      onChange: (v: Supplement) =>
        updateSettings({ supplements: { ...data.settings.supplements, holiday: v } }),
    });
  }
  it("clear -> 80 is stored as number 80 and re-read after reload; empty+blur never stores 0", () => {
    for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith("minijob-")) window.localStorage.removeItem(key);
    }
    activateScope(DEMO_SCOPE);
    replaceAll({
      ...EMPTY_DATA,
      settings: {
        ...DEFAULT_SETTINGS,
        supplements: {
          ...DEFAULT_SUPPLEMENTS,
          holiday: { enabled: true, mode: "prozent", value: 100 },
        },
      },
    });
    act(() => root.render(createElement(Lohn)));
    setText("");
    typeChars("80");
    blur();
    expect(input().value).toBe("80");
    expect(getData().settings.supplements.holiday).toEqual({
      enabled: true,
      mode: "prozent",
      value: 80,
    });
    // empty + blur: the stored value is untouched (not 0)
    setText("");
    blur();
    expect(input().value).toBe("80");
    expect(getData().settings.supplements.holiday.value).toBe(80);
    // re-read from storage (as after a reload)
    activateScope(DEMO_SCOPE);
    loadFromStorage();
    expect(getData().settings.supplements.holiday.value).toBe(80);
    expect(typeof getData().settings.supplements.holiday.value).toBe("number");
  });
});

describe("persistence: deleting digit by digit does not leave an intermediate value (real store)", () => {
  function Lohn() {
    const data = useAppData();
    return createElement(SupplementRow, {
      label: "Feiertag",
      value: data.settings.supplements.holiday,
      onChange: (v: Supplement) =>
        updateSettings({ supplements: { ...data.settings.supplements, holiday: v } }),
    });
  }
  function seed() {
    for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith("minijob-")) window.localStorage.removeItem(key);
    }
    activateScope(DEMO_SCOPE);
    replaceAll({
      ...EMPTY_DATA,
      settings: {
        ...DEFAULT_SETTINGS,
        supplements: {
          ...DEFAULT_SUPPLEMENTS,
          holiday: { enabled: true, mode: "prozent", value: 80 },
        },
      },
    });
  }
  it.each([
    ["Backspace x2", ["8", ""]],
    ["8 -> 0 -> empty", ["0", ""]],
    ["080 -> empty", ["080", ""]],
    ["select all + delete", [""]],
  ])("80, %s, blur -> store 80, number, still 80 after reload", (_n, texts) => {
    seed();
    act(() => root.render(createElement(Lohn)));
    for (const t of texts) setText(t);
    blur();
    expect(input().value).toBe("80");
    expect(getData().settings.supplements.holiday).toEqual({
      enabled: true,
      mode: "prozent",
      value: 80,
    });
    activateScope(DEMO_SCOPE);
    loadFromStorage();
    expect(getData().settings.supplements.holiday.value).toBe(80);
    expect(typeof getData().settings.supplements.holiday.value).toBe("number");
  });
});

describe("call sites use NumberField (no Number(e.target.value) || 0 left on edited fields)", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const wizard = read("../minijob/OnboardingWizard.tsx");
  const job = read("../minijob/JobDialog.tsx");

  it("wizard: 4 supplements + breakMinutes", () => {
    expect(wizard).toContain('import { NumberField } from "@/components/ui/number-field"');
    expect((wizard.match(/<NumberField/g) ?? []).length).toBe(2);
    expect(wizard).not.toMatch(/Number\(e\.target\.value\) \|\| 0/);
  });
  it("JobDialog: SupplementRow + breakMinutes", () => {
    expect(job).toContain('import { NumberField } from "@/components/ui/number-field"');
    expect((job.match(/<NumberField/g) ?? []).length).toBe(2);
    expect(job).not.toMatch(/Number\(e\.target\.value\) \|\| 0/);
  });
  it("Einstellungen reuses SupplementRow (fix applies there)", () => {
    const settings = read("../../routes/einstellungen.tsx");
    expect(settings).toMatch(
      /import \{[^}]*SupplementRow[^}]*\} from "@\/components\/minijob\/JobDialog"/,
    );
  });
});
