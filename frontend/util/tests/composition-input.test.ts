import {
    changeCompositionInput,
    createCompositionInputState,
    finishCompositionInput,
    isCompositionProtectedKeydown,
    startCompositionInput,
    syncCompositionExternalValue,
} from "@/util/composition-input";
import { describe, expect, it } from "vitest";

describe("composition input state", () => {
    it("commits normal typing immediately when not composing", () => {
        const state = createCompositionInputState("");

        expect(changeCompositionInput(state, "hello", false)).toEqual({
            draftValue: "hello",
            committedValue: "hello",
            isComposing: false,
            pendingExternalValue: "hello",
            staleExternalCandidates: [],
        });
    });

    it("keeps interim voice or IME text in draft only while composing", () => {
        const composingState = startCompositionInput(createCompositionInputState("已提交"));

        expect(changeCompositionInput(composingState, "已提交 口播中", true)).toEqual({
            draftValue: "已提交 口播中",
            committedValue: "已提交",
            isComposing: true,
            pendingExternalValue: null,
            staleExternalCandidates: [],
        });
    });

    it("ignores external sync while composition is still active", () => {
        const composingState = {
            draftValue: "草稿中",
            committedValue: "旧值",
            isComposing: true,
            pendingExternalValue: null,
            staleExternalCandidates: ["更旧值"],
        };

        expect(syncCompositionExternalValue(composingState, "外部覆盖")).toEqual(composingState);
    });

    it("commits the finalized text once composition ends", () => {
        const composingState = {
            draftValue: "中间态",
            committedValue: "旧值",
            isComposing: true,
            pendingExternalValue: null,
            staleExternalCandidates: [],
        };

        expect(finishCompositionInput(composingState, "最终文本")).toEqual({
            draftValue: "最终文本",
            committedValue: "最终文本",
            isComposing: false,
            pendingExternalValue: "最终文本",
            staleExternalCandidates: ["旧值"],
        });
    });

    it("rejects late stale external value while waiting for local commit echo", () => {
        const localCommitted = finishCompositionInput(
            {
                draftValue: "草稿",
                committedValue: "旧值",
                isComposing: true,
                pendingExternalValue: null,
                staleExternalCandidates: [],
            },
            "新值"
        );

        expect(syncCompositionExternalValue(localCommitted, "旧值")).toEqual(localCommitted);
        expect(syncCompositionExternalValue(localCommitted, "新值")).toEqual({
            draftValue: "新值",
            committedValue: "新值",
            isComposing: false,
            pendingExternalValue: null,
            staleExternalCandidates: ["旧值"],
        });
    });

    it("allows explicit clear even if an older commit echo is still pending", () => {
        const waitingState = {
            draftValue: "发送中的输入",
            committedValue: "发送中的输入",
            isComposing: false,
            pendingExternalValue: "发送中的输入",
            staleExternalCandidates: ["更旧输入"],
        };

        expect(syncCompositionExternalValue(waitingState, "")).toEqual({
            draftValue: "",
            committedValue: "",
            isComposing: false,
            pendingExternalValue: null,
            staleExternalCandidates: [],
        });
    });

    it("keeps rejecting known stale candidates after pending echo is resolved", () => {
        const state1 = changeCompositionInput(createCompositionInputState(""), "片段一", false);
        const state2 = syncCompositionExternalValue(state1, "片段一");
        const state3 = changeCompositionInput(state2, "片段一 片段二", false);
        const state4 = syncCompositionExternalValue(state3, "片段一 片段二");

        expect(syncCompositionExternalValue(state4, "片段一")).toEqual(state4);
    });
});

describe("composition protected keydown", () => {
    it("detects composing state from react/native signals", () => {
        expect(isCompositionProtectedKeydown(true, { key: "Enter" })).toBe(true);
        expect(isCompositionProtectedKeydown(false, { nativeEvent: { isComposing: true }, key: "Enter" })).toBe(true);
        expect(isCompositionProtectedKeydown(false, { keyCode: 229, key: "Enter" })).toBe(true);
        expect(isCompositionProtectedKeydown(false, { key: "Process" })).toBe(true);
        expect(isCompositionProtectedKeydown(false, { key: "Enter" })).toBe(false);
    });
});
