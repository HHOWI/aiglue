# @aiglue/client-vue

Vue 3 composable mirror of [`@aiglue/client`](../client/README.md). Same headless API — same confirm-token auto-echo, multi-turn history relay, and transport vs engine error split — exposed as Vue refs.

## Install

```bash
npm install @aiglue/client-vue @aiglue/core
# vue 3.x is a peer dep
```

## Use

```vue
<script setup lang="ts">
import { useAIGlue } from '@aiglue/client-vue'

const { send, sendConfirm, result, loading, error, reset } = useAIGlue({
  endpoint: '/ai/chat',
})
</script>

<template>
  <input
    @keydown.enter="send(($event.target as HTMLInputElement).value)"
    :disabled="loading"
  />

  <p v-if="loading">…</p>
  <p v-if="error">Network error: {{ error.message }}</p>

  <p v-if="result?.type === 'text'">{{ result.content }}</p>
  <YourTable v-else-if="result?.type === 'table'" :columns="result.columns" :rows="result.rows" />
  <p v-else-if="result?.type === 'summary'">{{ result.text }}</p>
  <p v-else-if="result?.type === 'action'">✓ {{ result.message }}</p>
  <p v-else-if="result?.type === 'error'">Error ({{ result.code }}): {{ result.message }}</p>

  <dialog v-if="result?.type === 'confirm'" open>
    <p>{{ result.message }}</p>
    <!-- sendConfirm() with no args echoes the captured confirmToken automatically -->
    <button @click="sendConfirm()">Confirm</button>
    <button @click="reset">Cancel</button>
  </dialog>
</template>
```

## API

```ts
useAIGlue(options: {
  endpoint: string
  fetchOptions?: Omit<RequestInit, 'method' | 'body'>
  userId?: string
  maxHistory?: number  // default 20
}): {
  send(message: string): Promise<AIEResponse>
  sendConfirm(override?: { toolName?, params?, idempotencyKey? }): Promise<AIEResponse>
  result: ShallowRef<AIEResponse | null>
  history: Ref<ChatMessage[]>
  loading: Ref<boolean>
  error: ShallowRef<Error | null>
  reset(): void
}
```

Behavior matches [`@aiglue/client`](../client/README.md) one-to-one — see that README for confirm idempotency, history relay, and the transport vs engine error split.

## What this composable does NOT do

- No rendered UI components. Renderers per response type stay yours.
- No streaming. Engine itself is non-streaming today; will revisit when the engine surface changes.
- No Svelte adapter. Same logic ports cleanly — open an issue if you need it.
