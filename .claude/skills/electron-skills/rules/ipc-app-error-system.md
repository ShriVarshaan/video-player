---
title: Structured Error Handling Across IPC Boundary
impact: CRITICAL
impactDescription: Prevents unstructured error swallowing and enables code-based error routing across process boundaries
tags: electron, ipc, error-handling, app-error
---

## Structured Error Handling Across IPC Boundary

Electron IPC serializes errors as strings. A structured error system ensures main process errors are thrown with a code + message + payload, serialized across IPC, parsed internally, and routed in the renderer through a single public entrypoint: `catchAppError`.

**Incorrect — unstructured error handling:**

```typescript
// main process
ipcMain.handle("save-user", async (_e, user) => {
  if (!user.name) throw new Error("Name is required");
  // ...
});

// renderer
try {
  await window.api.user.saveUser({ user });
} catch (e) {
  // e.message is mangled by IPC serialization
  // No way to distinguish error types
  alert(e.message);
}
```

Error messages get mangled crossing the IPC boundary. No structured way to route different errors to different handlers. Renderer can't distinguish "validation failed" from "database error."

**Correct — AppError system:**

### 1. Define the error system

```typescript
// src/domain/types/AppError.ts

// Error class for IPC serialization
export class AppErrorClass extends Error {}

// All error codes as a union type
export type AppErrorCode =
  | "user_not_found"
  | "validation_failed"
  | "duplicate_entry"
  | "file_not_found"
  | "unknown";

// Human-readable messages per code
export const appErrorMessages: Record<AppErrorCode, string> = {
  user_not_found: "User not found.",
  validation_failed: "Data validation failed.",
  duplicate_entry: "A record with this identifier already exists.",
  file_not_found: "The specified file could not be found.",
  unknown: "An unknown error occurred.",
};

export type AppError = {
  message: string;
  code: AppErrorCode;
  payload: any;
};
```

### 2. Throw errors in main process

`throwAppError` serializes the error as JSON inside an `AppErrorClass` instance so it survives IPC serialization.

```typescript
// Short form — code only (message auto-resolved from appErrorMessages)
throwAppError("user_not_found");

// Full form — custom message and/or payload
throwAppError({
  code: "validation_failed",
  message: "Field 'email' is invalid",
  payload: { field: "email", value: input.email },
});
```

Implementation:

```typescript
export function throwAppError(code: AppErrorCode): never;
export function throwAppError(options: {
  message?: string;
  code?: AppErrorCode;
  payload?: object;
}): never;
export function throwAppError(
  codeOrOptions:
    | AppErrorCode
    | { message?: string; code?: AppErrorCode; payload?: object },
): never {
  if (typeof codeOrOptions === "string") {
    throw new AppErrorClass(
      JSON.stringify({
        message: appErrorMessages[codeOrOptions],
        code: codeOrOptions,
      }),
    );
  }

  const {
    code = "unknown",
    message = appErrorMessages[code],
    payload,
  } = codeOrOptions;

  throw new AppErrorClass(JSON.stringify({ message, code, payload }));
}
```

### 3. Parse errors across IPC boundary internally

`parseAppError` extracts the JSON-encoded `AppError` from an `Error.message` that may be wrapped by Electron's IPC layer. Treat it as an internal helper for IPC utilities such as `catchAppError` and `registerIpcMainHandle`, not as a renderer-facing API.

```typescript
export const parseAppError = (error: unknown): AppError | null => {
  if (error instanceof Error) {
    // Extract JSON object from the end of the message
    // (Electron IPC may prepend extra text)
    try {
      let braceCount = 0;
      let startIndex = -1;
      const message = error.message.trim();

      for (let i = message.length - 1; i >= 0; i--) {
        if (message[i] === "}") braceCount++;
        else if (message[i] === "{") {
          braceCount--;
          if (braceCount === 0) { startIndex = i; break; }
        }
      }

      if (startIndex !== -1) {
        const parsed = JSON.parse(message.substring(startIndex));
        if (parsed && typeof parsed.code === "string") return parsed;
      }
    } catch {
      return null;
    }
  }
  return null;
};
```

### 4. Catch errors in renderer by code

`catchAppError` is the renderer-facing error utility. It parses the error internally and routes to the matching handler by code. Unmatched codes fall through to `DEFAULT`.

```typescript
export const catchAppError = (
  e: unknown,
  handlers: Partial<
    Record<AppErrorCode | "DEFAULT", (error: AppError) => void>
  >,
): void => {
  const appError = parseAppError(e);
  if (appError) {
    const handler = handlers[appError.code] || handlers["DEFAULT"];
    handler?.(appError);
    return;
  }
  handlers["DEFAULT"]?.({
    message: appErrorMessages["unknown"],
    code: "unknown",
    payload: e,
  });
};
```

Renderer usage:

```typescript
// React Query onError
onError: (e) => {
  catchAppError(e, {
    validation_failed: ({ payload }) => {
      setErrorField(payload.field);
      showErrorToast("Validation failed");
    },
    duplicate_entry: () => {
      showErrorToast("This record already exists");
    },
    DEFAULT: ({ code, message }) => {
      showErrorToast(`${code}: ${message}`);
    },
  });
},
```

Renderer rule:

- Use `catchAppError` directly inside `catch`, `onError`, or similar renderer error boundaries.
- Do not call `parseAppError` directly from renderer code.
- Do not add extra renderer-side app-error utilities unless there is a concrete need that `catchAppError` cannot handle.

### 5. Wire into registerIpcMainHandle

The IPC handler helper catches errors thrown in main process handlers, preserves `AppErrorClass` instances, and re-wraps unstructured errors.

```typescript
export const registerIpcMainHandle = <T extends keyof API, K extends keyof API[T]>(
  channel: string,
  handler: APIFunction<T, K>,
): void => {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    try {
      return await (handler as any)(...args);
    } catch (error) {
      if (error instanceof AppErrorClass) throw error;

      const appError = parseAppError(error);
      if (appError) throw new AppErrorClass(JSON.stringify(appError));

      throw error;
    }
  });
};
```

### Key rules

- Every known error condition gets an `AppErrorCode` entry
- Main process uses `throwAppError` — never raw `throw new Error`
- Renderer uses `catchAppError` with explicit code handlers + `DEFAULT` fallback
- `parseAppError` is internal-only and handles Electron's IPC message wrapping
- Renderer should not need `parseAppError` or additional app-error helper utilities beyond `catchAppError`
- `registerIpcMainHandle` preserves `AppErrorClass` across IPC boundary
- Add new error codes to the `AppErrorCode` union and `appErrorMessages` record together

Reference:
[Electron IPC Error Handling](https://www.electronjs.org/docs/latest/tutorial/ipc)
