import { beforeEach, describe, expect, it, vi } from "vitest";

const recvRpcMessage = vi.fn();

vi.mock("@/app/store/wps", () => ({
    setWpsRpcClient: vi.fn(),
    wpsReconnectHandler: vi.fn(),
}));

vi.mock("@/app/store/wshclient", () => ({
    WshClient: class {},
}));

vi.mock("@/app/store/wshrouter", () => ({
    WshRouter: class {},
}));

vi.mock("@/util/endpoints", () => ({
    getWSServerEndpoint: vi.fn(),
}));

vi.mock("@/app/store/ws", () => ({
    addWSReconnectHandler: vi.fn(),
    globalWS: null,
    initGlobalWS: vi.fn(),
}));

describe("sendRpcCommand", () => {
    beforeEach(() => {
        recvRpcMessage.mockReset();
        vi.resetModules();
    });

    it("sends cancel when the response generator is closed before the stream completes", async () => {
        const { sendRpcCommand, setDefaultRouter } = await import("../wshrpcutil-base");
        const openRpcs = new Map<string, any>();
        const reqid = "req-1";

        setDefaultRouter({
            recvRpcMessage: recvRpcMessage,
        } as any);

        const rpcGen = sendRpcCommand(openRpcs, {
            command: "stream-test",
            reqid,
            route: "route-1",
            source: "fe:test",
        } as any);

        openRpcs.get(reqid).msgFn({
            resid: reqid,
            data: { chunk: 1 },
            cont: true,
        });

        await expect(rpcGen.next()).resolves.toEqual({
            value: { chunk: 1 },
            done: false,
        });

        await expect(rpcGen.return(undefined)).resolves.toEqual({
            value: undefined,
            done: true,
        });

        expect(recvRpcMessage).toHaveBeenLastCalledWith({
            reqid,
            cancel: true,
        });
        expect(openRpcs.has(reqid)).toBe(false);
    });
});
