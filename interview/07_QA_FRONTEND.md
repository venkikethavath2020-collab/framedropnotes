# Interview Q&A — Frontend (Vue 3, Pinia, TypeScript)

---

## Q1: Why did you choose Pinia over Vuex?

**Beginner answer:**
Pinia is the official state manager for Vue 3. It's simpler than Vuex — no mutations, just actions and state.

**Mid-level answer:**
Pinia setup stores use Vue 3's `ref()` and `computed()` directly — there's no separate `state/mutations/actions` ceremony. This means store logic feels identical to composable logic, which reduces cognitive load. TypeScript inference works out of the box — no manual typing of `GetterTree` or `ActionContext`. DevTools support is as good as Vuex. Vuex 4 still works with Vue 3 but is in maintenance mode; Pinia is the officially recommended path.

**Senior answer:**
The setup store pattern (`defineStore('x', () => { ... })`) has a key advantage: the store is just a function returning reactive state, so it composes cleanly with other composables. Every store in FrameDrops follows the same shape:
- `ref<T[]>([])` for collections
- `ref(false)` for `loading`
- `ref<string | null>(null)` for `error`
- Async actions that set loading/error and re-throw so views can handle UI feedback

Re-throwing in stores is a deliberate pattern: the store manages shared state, but view-local UI behavior (showing a snackbar, navigating away) is the view's responsibility. If the store swallows errors, views can't react.

**"How do you handle store hydration on page load?"**
> Each view calls `store.fetch*()` in `onMounted()`. There's no SSR, so server-side hydration isn't needed. For data that's needed before any view renders (e.g., `authStore.user`), we initialize in the router's `beforeEach` guard.

---

## Q2: How does the router navigation guard work?

**Mid-level answer:**
`router/index.ts` has a `beforeEach` guard that checks if a route requires authentication. If yes, it checks if the JWT is present and valid (not expired). If not, it redirects to login.

**Senior answer:**
The guard checks `route.meta.requiresAuth`. For protected routes:
1. Get the token from `authStore`
2. Check if token is expired by decoding the `exp` claim (no need for a server call — the expiry is in the payload)
3. If expired → redirect to `/login` with `redirect` query param so the user returns after login

For public routes (`/gallery/:shareId`, landing page), no check is performed.

There's also an `afterEach` hook for SEO — it updates `document.title` and meta tags via `useSeo` composable using `route.meta.title` and `route.meta.description`.

**"Why not validate the JWT signature client-side?"**
> The JWT secret is server-only. Client-side code can only check expiry (from the `exp` claim). The actual signature validation happens on the server for every API request. This is the correct model — the client checks "do I even have a non-expired token to send?" as a UX optimization, not as a security check.

---

## Q3: Explain the upload store and engine relationship.

**Mid-level answer:**
The `upload` store (`stores/upload.ts`) is a Pinia façade over the `UploadEngine` (`services/upload/engine.ts`). The engine is the real implementation — it handles compression, signing, uploading to R2, finalizing. The store exposes engine state as reactive Pinia refs so Vue components can bind to upload progress.

**Senior answer:**
The engine is a module singleton — it's instantiated once when the app boots (`bootUploadEngine()` in `main.ts`) and lives for the entire app lifecycle, surviving Vue Router navigation. This was a deliberate architectural decision because the old `useBulkUploadManager` composable was component-scoped and died when the user navigated to another view — losing all upload progress.

The store doesn't own the state — it reads from the engine's event emitter and exposes derived reactive state. When the engine emits `fileProgress` or `jobComplete` events, the store updates its refs, triggering Vue's reactivity system to re-render progress indicators.

`pauseUploadsForLogout()` is called from the auth store on logout — it tells the engine to stop processing and clears the IndexedDB state so the next user doesn't see the previous user's uploads.

**"Why not put the upload engine logic directly in the Pinia store?"**
> The engine has complex internal state (worker pool, IndexedDB, file state machines) that needs to survive across store resets. Pinia stores can be reset with `$reset()` — if the engine lived in the store, a reset would destroy in-flight upload state. The engine as a module singleton is isolated from Pinia's lifecycle, which is the right boundary.

---

## Q4: How did you structure TypeScript types across the project?

**Mid-level answer:**
All types live in `src/types/` — one file per domain (album, photo, auth, payment, etc.). They're barrel-exported from `src/types/index.ts`. API response types mirror the backend response shape.

**Senior answer:**
The types serve three purposes:
1. **API contract** — `types/api.ts` defines `ApiResponse<T>` which wraps every backend response. This forces every service function to be typed correctly.
2. **Domain models** — `types/album.ts`, `types/photo.ts`, etc. define the shape of entities as the frontend understands them. These may differ slightly from DB rows (snake_case vs camelCase, computed fields).
3. **Upload state** — `types/upload.ts` / `services/upload/types.ts` define the file and job state machine types (`UploadJob`, `UploadFile`, `JobStatus`, `FileStatus`). These are the most complex types in the frontend.

One deliberate choice: types are `.ts` files, not `interface` files inside components. This makes them tree-shakeable and importable in non-Vue contexts (utilities, workers, tests).

**"How do you handle API responses that don't match the expected type?"**
> We trust the backend contract at runtime — there's no Zod validation on API responses. This is a gap. A malformed API response would propagate as `undefined` or `null` access, causing runtime errors rather than type errors. For a production SaaS, adding Zod or `valibot` validation at the `apiClient` layer would catch contract mismatches early.

---

## Q5: How does Vue 3 reactivity work in the Pinia stores?

**Mid-level answer:**
`ref()` creates a reactive reference. Changing `.value` on a ref triggers any watchers or computed properties that depend on it. Components that access store properties via `storeToRefs()` or direct destructuring get reactive references that update the DOM automatically.

**Senior answer:**
Vue 3 uses a Proxy-based reactivity system. When you access a property on a reactive object in a component's template or computed, Vue tracks that access as a dependency. When the property changes, Vue invalidates and re-runs all dependents.

In setup stores, `ref()` is the primitive. `computed()` creates derived state (e.g., `filteredAlbums` computed from `albums` + `searchQuery`). The key thing to understand: `storeToRefs(store)` is needed when destructuring from a store in a component — otherwise you get a plain value, not a reactive ref.

```ts
// Correct — albumList is reactive
const { albums, loading } = storeToRefs(useAlbumsStore())

// Wrong — albums is a plain array snapshot, won't update
const { albums, loading } = useAlbumsStore()
```

Actions can be destructured without `storeToRefs` because functions are not reactive.

**"How does Vue know which component to re-render when a store value changes?"**
> When the component's template renders, it accesses the ref's `.value` through the reactive Proxy. Vue's effect tracking records this access. When `.value` is mutated, Vue's scheduler marks all dependent effects (component renders, computed, watchers) as dirty and queues a re-render in the next microtask batch. This is why reactivity is synchronous in terms of tracking but asynchronous in terms of DOM updates — you can change multiple refs and only get one DOM update flush.
