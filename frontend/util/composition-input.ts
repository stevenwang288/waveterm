import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type ChangeEvent,
    type FocusEvent,
    type CompositionEvent as ReactCompositionEvent,
} from "react";

export type CompositionInputState = {
    draftValue: string;
    committedValue: string;
    isComposing: boolean;
    pendingExternalValue: string | null;
    staleExternalCandidates: string[];
};

const MAX_STALE_EXTERNAL_CANDIDATES = 8;

function addStaleExternalCandidate(candidates: string[], value: string): string[] {
    if (value === "") {
        return candidates;
    }
    if (candidates[candidates.length - 1] === value) {
        return candidates;
    }
    const nextCandidates = [...candidates, value];
    if (nextCandidates.length <= MAX_STALE_EXTERNAL_CANDIDATES) {
        return nextCandidates;
    }
    return nextCandidates.slice(nextCandidates.length - MAX_STALE_EXTERNAL_CANDIDATES);
}

function commitCompositionInputValue(state: CompositionInputState, nextValue: string): CompositionInputState {
    if (state.committedValue === nextValue) {
        if (
            state.draftValue === nextValue &&
            !state.isComposing &&
            state.pendingExternalValue == null
        ) {
            return state;
        }
        return {
            ...state,
            draftValue: nextValue,
            committedValue: nextValue,
            isComposing: false,
        };
    }
    return {
        draftValue: nextValue,
        committedValue: nextValue,
        isComposing: false,
        pendingExternalValue: nextValue,
        staleExternalCandidates: addStaleExternalCandidate(state.staleExternalCandidates, state.committedValue),
    };
}

export function createCompositionInputState(value: string): CompositionInputState {
    return {
        draftValue: value,
        committedValue: value,
        isComposing: false,
        pendingExternalValue: null,
        staleExternalCandidates: [],
    };
}

export function syncCompositionExternalValue(state: CompositionInputState, externalValue: string): CompositionInputState {
    if (state.isComposing) {
        return state;
    }

    if (state.pendingExternalValue != null) {
        // While waiting for local commit echo, reject out-of-order stale writebacks.
        if (externalValue !== state.pendingExternalValue && externalValue !== "") {
            return state;
        }
        return {
            draftValue: externalValue,
            committedValue: externalValue,
            isComposing: false,
            pendingExternalValue: null,
            staleExternalCandidates: externalValue === "" ? [] : state.staleExternalCandidates,
        };
    }

    if (state.draftValue === externalValue && state.committedValue === externalValue) {
        return state;
    }
    if (externalValue !== state.committedValue && state.staleExternalCandidates.includes(externalValue)) {
        return state;
    }
    return {
        draftValue: externalValue,
        committedValue: externalValue,
        isComposing: false,
        pendingExternalValue: null,
        staleExternalCandidates: [],
    };
}

export function startCompositionInput(state: CompositionInputState): CompositionInputState {
    if (state.isComposing) {
        return state;
    }
    return {
        ...state,
        isComposing: true,
    };
}

export function changeCompositionInput(
    state: CompositionInputState,
    nextValue: string,
    nativeIsComposing: boolean
): CompositionInputState {
    if (state.isComposing || nativeIsComposing) {
        return {
            ...state,
            draftValue: nextValue,
        };
    }
    return commitCompositionInputValue(state, nextValue);
}

export function finishCompositionInput(state: CompositionInputState, nextValue: string): CompositionInputState {
    return commitCompositionInputValue(state, nextValue);
}

type CompositionKeyEventLike = {
    key?: string;
    keyCode?: number;
    nativeEvent?: {
        isComposing?: boolean;
        keyCode?: number;
    };
};

export function isCompositionProtectedKeydown(
    isComposingState: boolean,
    event: CompositionKeyEventLike
): boolean {
    return (
        isComposingState ||
        Boolean(event.nativeEvent?.isComposing) ||
        event.keyCode === 229 ||
        event.nativeEvent?.keyCode === 229 ||
        event.key === "Process"
    );
}

export function useCompositionSafeTextarea(externalValue: string, onCommit: (nextValue: string) => void) {
    const [state, setState] = useState(() => createCompositionInputState(externalValue));
    const stateRef = useRef(state);
    const onCommitRef = useRef(onCommit);

    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    useEffect(() => {
        onCommitRef.current = onCommit;
    }, [onCommit]);

    useEffect(() => {
        setState((prev) => syncCompositionExternalValue(prev, externalValue));
    }, [externalValue]);

    const commitDraftValue = useCallback((nextValue?: string) => {
        const resolvedValue = nextValue ?? stateRef.current.draftValue;
        const shouldCommit =
            stateRef.current.committedValue !== resolvedValue || stateRef.current.pendingExternalValue != null;
        setState((prev) => finishCompositionInput(prev, resolvedValue));
        if (shouldCommit) {
            onCommitRef.current(resolvedValue);
        }
        return resolvedValue;
    }, []);

    const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
        const nextValue = e.target.value;
        const nativeEvent = e.nativeEvent as InputEvent & { isComposing?: boolean };
        const nativeIsComposing = Boolean(nativeEvent?.isComposing);
        const isCurrentlyComposing = stateRef.current.isComposing || nativeIsComposing;
        const shouldCommit =
            !isCurrentlyComposing &&
            (stateRef.current.committedValue !== nextValue || stateRef.current.pendingExternalValue != null);

        setState((prev) => changeCompositionInput(prev, nextValue, nativeIsComposing));
        if (shouldCommit) {
            onCommitRef.current(nextValue);
        }
    }, []);

    const handleCompositionStart = useCallback(() => {
        setState((prev) => startCompositionInput(prev));
    }, []);

    const handleCompositionEnd = useCallback(
        (e: ReactCompositionEvent<HTMLTextAreaElement>) => {
            commitDraftValue(e.currentTarget.value);
        },
        [commitDraftValue]
    );

    const handleBlurWhileComposing = useCallback(
        (e: FocusEvent<HTMLTextAreaElement>) => {
            if (!stateRef.current.isComposing) {
                return;
            }
            commitDraftValue(e.currentTarget.value);
        },
        [commitDraftValue]
    );

    return {
        value: state.draftValue,
        isComposingRef: stateRef,
        handleChange,
        handleCompositionStart,
        handleCompositionEnd,
        handleBlurWhileComposing,
        commitDraftValue,
    };
}
