---
title: Type-Safe IPC Architecture
impact: CRITICAL
impactDescription: Prevents type drift and silent runtime failures across process boundaries
tags: electron, ipc, type-safety, preload, bridge, handler
---

## Type-Safe IPC Architecture

End-to-end type-safe Electron IPC using a central `API` type, helper functions (`createIpcInvoker`, `registerIpcMainHandle`), and a consistent 5-step wiring process.

**Incorrect — scattered, untyped IPC:**

```typescript
// preload.ts — no type link, any params
contextBridge.exposeInMainWorld("api", {
  getUser: (id: string) => ipcRenderer.invoke("get-user", id),
  saveUser: (user: any) => ipcRenderer.invoke("save-user", user),
});

// main.ts — channel strings can silently drift
ipcMain.handle("get-user", (_e, id) => db.findUser(id));
```

Channel names are strings with no compile-time link. Parameter/return types are `any`. Renaming a channel in one place silently breaks the other.

**Correct — centralized type-safe architecture:**

### 1. Central API type (single source of truth)

```typescript
// src/domain/api/API.ts

type UserAPI = {
  getUser: (params: { id: string }) => Promise<User>;
  saveUser: (params: { user: Omit<User, "id" | "createdAt"> }) => Promise<void>;
  deleteUser: (params: { id: string }) => Promise<void>;
};

type DialogAPI = {
  openFile: (params: { extensions: string[] }) => Promise<string | null>;
};

export type API = {
  user: UserAPI;
  dialog: DialogAPI;
};

// Extract function type for a specific API method
export type APIFunction<T extends keyof API, K extends keyof API[T]> = API[T][K];

// Extract parameter type for a specific API method
export type APIParams<T extends keyof API, K extends keyof API[T]> = Parameters<API[T][K]>[0];
```

Rules: one sub-type per domain, every method takes a single object param, every method returns `Promise<T>`.

### 2. Helper functions

```typescript
// src/domain/api/API.ts (same file)

// Preload side — creates a typed invoker for a channel
export const createIpcInvoker = <T extends keyof API, K extends keyof API[T]>(
  channel: string,
): APIFunction<T, K> => {
  return ((...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args)) as APIFunction<T, K>;
};

// Main side — registers a typed handler for a channel
export const registerIpcMainHandle = <T extends keyof API, K extends keyof API[T]>(
  channel: string,
  handler: APIFunction<T, K>,
): void => {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    return await (handler as any)(...args);
  });
};
```

### 3. Preload bridge

One bridge file per domain. Uses `createIpcInvoker` — never raw `ipcRenderer`.

```typescript
// src/preload/bridges/userBridge.ts
import { createIpcInvoker } from "@domain/api/API";

export const userBridge = {
  getUser:    createIpcInvoker<"user", "getUser">("app:user-get"),
  saveUser:   createIpcInvoker<"user", "saveUser">("app:user-save"),
  deleteUser: createIpcInvoker<"user", "deleteUser">("app:user-delete"),
};
```

Bridges assembled and exposed in preload entry:

```typescript
// src/preload/index.ts
import { contextBridge } from "electron";
import { userBridge } from "./bridges/userBridge";
import { dialogBridge } from "./bridges/dialogBridge";

const api = {
  user: userBridge,
  dialog: dialogBridge,
};

contextBridge.exposeInMainWorld("api", api);
```

Window type declaration:

```typescript
// src/preload/index.d.ts
import type { API } from "@domain/api/API";

declare global {
  interface Window {
    api: API;
  }
}
```

### 4. Main process handlers

Business logic in `index.ts` typed with `APIFunction`. Registration in `ipcHandlers.ts` using `registerIpcMainHandle`.

```typescript
// src/main/feature/user/index.ts
import type { APIFunction } from "@domain/api/API";

export const getUser: APIFunction<"user", "getUser"> = async ({ id }) => {
  return db.findUser(id);
};

export const saveUser: APIFunction<"user", "saveUser"> = async ({ user }) => {
  return db.create(user);
};
```

```typescript
// src/main/feature/user/ipcHandlers.ts
import { registerIpcMainHandle } from "@domain/api/API";
import { getUser, saveUser, deleteUser } from "./index";

export const registerUserIpcHandlers = () => {
  registerIpcMainHandle<"user", "getUser">("app:user-get", getUser);
  registerIpcMainHandle<"user", "saveUser">("app:user-save", saveUser);
  registerIpcMainHandle<"user", "deleteUser">("app:user-delete", deleteUser);
};
```

All feature registrations called from main entry:

```typescript
// src/main/index.ts
import { registerUserIpcHandlers } from "./feature/user/ipcHandlers";
import { registerDialogIpcHandlers } from "./feature/dialog/ipcHandlers";

const registerIpcHandlers = () => {
  registerUserIpcHandlers();
  registerDialogIpcHandlers();
};

registerIpcHandlers();
```

### 5. Renderer usage

After wiring, the renderer calls APIs with full type safety:

```typescript
const user = await window.api.user.getUser({ id: "abc123" });

await window.api.user.saveUser({
  user: { name: "Kim", email: "kim@example.com" },
});
```

### Adding a new IPC API — 5-step checklist

| Step | File | Action |
|------|------|--------|
| 1 | `src/domain/api/API.ts` | Add domain type to `API` |
| 2 | `src/main/feature/{domain}/index.ts` | Implement with `APIFunction` typing |
| 3 | `src/main/feature/{domain}/ipcHandlers.ts` | Register with `registerIpcMainHandle` |
| 4 | `src/preload/bridges/{domain}Bridge.ts` | Create with `createIpcInvoker` |
| 5 | `src/preload/index.ts` | Add bridge to `api` object |

### Channel naming convention

```
{app-prefix}:{domain}-{action}
```

Examples: `app:user-get`, `app:store-set`, `app:dialog-open-file`

### Common mistakes

- **Mismatched channel strings** — bridge says `"app:notify-send"` but handler registers `"app:notification-send"`. No compile error, silent failure at runtime.
- **Forgetting to register** — handler function exists but `registerIpcMainHandle` is never called.
- **Missing bridge in preload entry** — bridge file exists but not imported in `index.ts`. Renderer gets `undefined`.

Reference:
- [Electron IPC Tutorial](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [Electron Context Bridge](https://www.electronjs.org/docs/latest/api/context-bridge)
- [Electron Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)
