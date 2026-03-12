import { describe, expect, it } from "vitest";
import { shouldDispatchToBlockForActiveElement } from "../keymodel";

function makeKeyEvent(key: string): WaveKeyboardEvent {
    return {
        type: "keydown",
        key,
        code: key === "Tab" ? "Tab" : `Key${String(key).toUpperCase()}`,
        shift: false,
        control: false,
        alt: false,
        meta: false,
        cmd: false,
        option: false,
        repeat: false,
        location: 0,
    } as WaveKeyboardEvent;
}

function makeActiveElement(tagName: string, classes: string[] = []) {
    return {
        tagName,
        contentEditable: "inherit",
        classList: {
            contains: (token: string) => classes.includes(token),
        },
    };
}

describe("shouldDispatchToBlockForActiveElement", () => {
    it("blocks Tab for normal textareas", () => {
        const textarea = makeActiveElement("TEXTAREA");

        expect(shouldDispatchToBlockForActiveElement(textarea, makeKeyEvent("Tab"), false)).toBe(false);
    });

    it("allows Tab for xterm helper textarea so pane switching still works", () => {
        const textarea = makeActiveElement("TEXTAREA", ["xterm-helper-textarea"]);

        expect(shouldDispatchToBlockForActiveElement(textarea, makeKeyEvent("Tab"), false)).toBe(true);
    });

    it("still blocks character input for normal inputs", () => {
        const input = makeActiveElement("INPUT");

        expect(shouldDispatchToBlockForActiveElement(input, makeKeyEvent("a"), false)).toBe(false);
    });
});
