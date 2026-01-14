# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    # Webapp Test (Vite 7 + React)

    `packages/webapp-test` is a lightweight Vite **7.x** workspace that validates the browser story for `@substancelabs/aztec-evm-bridge-sdk`. It focuses on the `OrderDataEncoder`, making it easy to craft ERC-7683 orders, encode them to hex, and decode payloads back into structured data.

    ## Highlights

    - React + TypeScript running on the latest Vite 7 toolchain
    - WASM, top-level await, and Node polyfills so the SDK loads in browsers without extra tweaks
    - Interactive form with instant encoding/decoding feedback
    - Lives inside the monorepo so it can consume the local SDK build

    ## Commands

    From the repo root:

    ```bash
    # Install dependencies (once)
    yarn install

    # Start the dev server with HMR
    yarn workspace webapp-test dev

    # Create a production build
    yarn workspace webapp-test build

    # Preview the production build locally
    yarn workspace webapp-test preview
    ```

    The dev server runs at `http://localhost:5173` by default.

    ## Using the playground

    1. Launch `yarn workspace webapp-test dev` and open the app.
    2. Tweak any order field—addresses are auto-padded to bytes32 for convenience.
    3. Click **Encode order** to call `OrderDataEncoder.encode()` from the SDK.
    4. Paste any payload into the textarea and click **Decode payload** to inspect the structured output.

    Because the app mirrors the SDK's browser requirements (Vite 7, IndexedDB-friendly polyfills, etc.), it's a convenient spot to reproduce issues before integrating the bridge into a production front-end.
      // Enable lint rules for React DOM
