<template>
  <section class="image-studio flex h-full min-h-0 flex-col">
    <div class="image-studio-toolbar flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3 sm:px-5 dark:border-dark-700">
      <Select id="drawing-key" :model-value="selected" :options="keyOptions" placeholder="选择绘图分组" aria-label="绘图分组" aria-describedby="drawing-group-help" class="min-w-0 w-40 sm:w-52 max-w-full" :disabled="loading" @update:model-value="changeKey">
        <template #selected>
          <span class="flex items-center gap-2">
            <span class="min-w-0 flex-1"><span class="block text-xs text-gray-500 dark:text-gray-400">绘图分组</span><span class="block truncate">{{ selectedKey?.group?.name || '请选择' }}</span></span>
            <span v-if="selectedKey" class="text-xs text-gray-400">切换</span>
          </span>
        </template>
        <template #header><p class="max-w-72 whitespace-normal text-xs leading-5 text-gray-500 dark:text-gray-400">选择用于绘图的 API 密钥，使用其绑定的分组与额度。</p></template>
        <template #option="{ option, selected: isSelected }">
          <span v-if="option.value" class="min-w-0 flex-1 whitespace-normal break-words">
            <span class="block font-medium">{{ option.groupName }}</span>
            <span class="mt-1 block text-xs text-gray-500 dark:text-gray-400">密钥：{{ option.keyName }} · 计费倍率：{{ option.rate }}×</span>
            <span class="mt-1 block text-xs text-gray-500 dark:text-gray-400">{{ option.quota }}</span>
          </span>
          <span v-else>{{ option.label }}</span>
          <span v-if="isSelected" aria-hidden="true" class="shrink-0 text-primary-500">✓</span>
        </template>
      </Select>
      <details class="relative">
        <summary class="cursor-pointer list-none rounded-lg px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 dark:hover:bg-dark-800">查看密钥与额度</summary>
        <div class="absolute left-0 top-full z-30 mt-2 w-64 max-w-[80vw] rounded-xl border border-gray-100 bg-white p-3 text-xs shadow-lg dark:border-dark-700 dark:bg-dark-800">
          <p v-if="selectedKey" class="mb-3 break-words leading-6 text-gray-500">密钥：{{ selectedKey.name }}<br />分组：{{ selectedKey.group?.name }}<br />计费倍率：{{ multiplier(selectedKey) }}×<br />{{ quota(selectedKey) }}</p>
          <button class="block w-full rounded-lg px-2 py-2 text-left hover:bg-gray-50 dark:hover:bg-dark-700" :disabled="loading || connecting" @click="loadKeys">刷新密钥</button>
          <router-link class="block rounded-lg px-2 py-2 text-primary-600 hover:bg-gray-50 dark:hover:bg-dark-700" to="/keys">管理密钥</router-link>
        </div>
      </details>
      <details class="relative">
        <summary class="cursor-pointer list-none rounded-lg px-2 py-2 text-xs text-gray-500 hover:bg-gray-50 dark:hover:bg-dark-800">计费倍率 <span aria-hidden="true">ⓘ</span></summary>
        <p class="absolute left-0 top-full z-30 mt-2 w-64 max-w-[80vw] rounded-xl border border-gray-100 bg-white p-3 text-xs leading-6 text-gray-600 shadow-lg dark:border-dark-700 dark:bg-dark-800 dark:text-gray-300">倍率影响实际费用，不代表每张图片的价格；最终费用以用量记录为准。</p>
      </details>
      <p id="drawing-group-help" class="order-last w-full text-xs leading-5 text-gray-500 dark:text-gray-400 lg:order-none lg:w-auto lg:min-w-64 lg:flex-1">
        切换分组即使用对应密钥的权限与额度。<br />倍率影响费用，实际扣费以用量记录为准。
      </p>
      <span v-if="busy" role="status" class="text-xs text-primary-600">作品生成中</span>
      <button aria-label="绘图设置" class="ml-auto rounded-lg px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-40 dark:hover:bg-dark-800" :disabled="!selected || connecting" @click="openSettings"><span class="hidden sm:inline">绘图</span>设置</button>
    </div>
    <p v-if="error" role="alert" class="px-4 py-3 text-sm text-red-600">{{ error }} <button v-if="selected" class="underline" @click="connect">重新连接</button></p>
    <div v-if="loading" class="p-8 text-sm text-gray-500">正在读取你的绘图密钥…</div>
    <div v-else-if="!selected || !opened" class="flex flex-1 items-center justify-center p-6 text-center">
      <div><h2 class="text-xl font-semibold">{{ selected ? '继续你的图片创作' : '在这里开始创作' }}</h2><p class="mt-3 text-sm leading-6 text-gray-500">{{ selected ? '绘图分组已就绪，对话与作品仍保存在这个浏览器。' : '选择一把开放图片权限的密钥，费用按该密钥所属分组计算。' }}<br />{{ keys.length ? '切换密钥可以切换分组，作品按密钥独立保存。' : '暂无可用绘图密钥，请到「API 密钥」创建，或联系管理员开放分组图片权限。' }}</p><button v-if="selected" class="mt-6 rounded-full bg-primary-600 px-6 py-3 text-sm font-medium text-white hover:bg-primary-700" @click="connect">进入创作空间</button></div>
    </div>
    <div v-else class="relative min-h-0 flex-1">
      <p v-if="connecting" role="status" class="absolute inset-x-0 top-0 z-10 bg-white/95 p-3 text-center text-sm text-gray-500 dark:bg-dark-900">正在连接绘图工作区…</p>
      <iframe :key="frameVersion" ref="frame" :name="`mazal-image-${frameName}-${frameVersion}`" :src="`${imageWorkbenchOrigin}/embed?embed=mazal`" title="AI 绘图工作区" class="h-full w-full border-0" referrerpolicy="origin" allow="clipboard-write" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import Select from '@/components/common/Select.vue'
import { imageWorkbenchOrigin } from '@/config/imageWorkbench'
import { useAuthStore } from '@/stores/auth'
import { apiClient } from '@/api/client'
import * as keysAPI from '@/api/keys'
import { getUserGroupRates } from '@/api/groups'
import type { ApiKey } from '@/types'

const auth = useAuthStore()
const keys = ref<ApiKey[]>([])
const rates = ref<Record<number, number>>({})
const selected = ref('')
const loading = ref(false)
const connecting = ref(false)
const error = ref('')
const frame = ref<HTMLIFrameElement | null>(null)
const frameVersion = ref(0)
const frameName = crypto.randomUUID()
const opened = ref(false)
const busy = ref(false)
let version = 0
let timeout: ReturnType<typeof setTimeout> | undefined
let loadRetry: ReturnType<typeof setTimeout> | undefined
let pendingNonce = ''
const preference = () => `mazal-drawing-key-${auth.user?.id}`
const multiplier = (key: ApiKey) => key.group?.image_rate_independent ? key.group.image_rate_multiplier : rates.value[key.group_id || 0] ?? key.group?.rate_multiplier
const quota = (key: ApiKey) => key.quota > 0 ? `额度 $${Math.max(0, key.quota - key.quota_used).toFixed(4)}` : '按账户可用额度'
const selectedKey = computed(() => keys.value.find((key) => String(key.id) === selected.value))
const keyOptions = computed(() => [
  { value: '', label: '暂不选择分组' },
  ...keys.value.map((key) => ({
    value: String(key.id),
    label: `${key.group?.name} · 密钥：${key.name} · 计费倍率：${multiplier(key)}× · ${quota(key)}`,
    groupName: key.group?.name,
    keyName: key.name,
    rate: multiplier(key),
    quota: quota(key),
  }))
])

function connect() {
  version++
  opened.value = true
  pendingNonce = ''
  busy.value = false
  error.value = ''
  connecting.value = true
  frameVersion.value++
  clearTimeout(timeout)
  clearTimeout(loadRetry)
  // 首次导航未收到握手时只重新导航一次，避免重试打断登录交接。
  loadRetry = setTimeout(() => {
    version++
    pendingNonce = ''
    if (frame.value) frame.value.src = `${imageWorkbenchOrigin}/embed?embed=mazal&entry=${frameName}-${frameVersion.value}-retry`
  }, 8_000)
  timeout = setTimeout(() => {
    connecting.value = false
    error.value = '绘图页连接超时，请重试；也可以使用独立绘图站。'
  }, 35_000)
}

function changeKey(value: string | number | boolean | null) {
  const next = String(value ?? '')
  if (next === selected.value) return
  if (busy.value && !window.confirm('当前密钥有任务处理中。切换不会取消已提交任务，切回后可继续查看。是否切换？')) {
    return
  }
  selected.value = next
  if (next) {
    localStorage.setItem(preference(), next)
    connect()
  } else {
    version++
    clearTimeout(timeout)
    clearTimeout(loadRetry)
    connecting.value = false
    busy.value = false
  }
}

async function loadKeys() {
  loading.value = true
  error.value = ''
  try {
    rates.value = await getUserGroupRates().catch(() => ({}))
    const all: ApiKey[] = []
    for (let page = 1; page <= 100; page++) {
      const result = await keysAPI.list(page, 100, { status: 'active' })
      all.push(...result.items)
      if (page >= result.pages) break
    }
    keys.value = all.filter((key) => key.status === 'active' && key.group?.status === 'active' && key.group.allow_image_generation && (!key.expires_at || Date.parse(key.expires_at) > Date.now()))
    const remembered = localStorage.getItem(preference())
    const previous = selected.value
    selected.value = keys.value.some((key) => String(key.id) === (previous || remembered)) ? (previous || remembered || '') : ''
    if (selected.value && opened.value) connect()
  } catch {
    error.value = '无法读取绘图密钥，请刷新重试。'
  } finally {
    loading.value = false
  }
}

async function onMessage(event: MessageEvent) {
  if (event.origin !== imageWorkbenchOrigin || event.source !== frame.value?.contentWindow || !event.data || typeof event.data !== 'object') return
  if (event.data.type === 'mazal-image-state') {
    busy.value = event.data.active === true
    return
  }
  if (event.data.type === 'mazal-image-connected') {
    clearTimeout(timeout)
    clearTimeout(loadRetry)
    connecting.value = false
    error.value = ''
    return
  }
  if (event.data.type === 'mazal-image-error') {
    clearTimeout(timeout)
    clearTimeout(loadRetry)
    connecting.value = false
    error.value = '绘图登录交接失败，请重新连接或检查密钥权限。'
    return
  }
  if (event.data.type !== 'mazal-image-ready' || !selected.value || !/^[A-Za-z0-9_-]{20,128}$/.test(event.data.nonce)) return
  if (pendingNonce === event.data.nonce) return
  pendingNonce = event.data.nonce
  clearTimeout(loadRetry)
  const current = version
  const target = event.source as Window
  try {
    const { data } = await apiClient.post('/image-workbench/ticket', { key_id: Number(selected.value), nonce: event.data.nonce })
    if (current !== version || target !== frame.value?.contentWindow) return
    target.postMessage({ type: 'mazal-image-ticket', nonce: event.data.nonce, ticket: data.ticket }, imageWorkbenchOrigin)
  } catch {
    if (current !== version) return
    clearTimeout(timeout)
    connecting.value = false
    error.value = '此密钥暂时无法连接绘图，请检查有效期、IP 限制或分组权限。'
  }
}

function openSettings() {
  frame.value?.contentWindow?.postMessage({ type: 'mazal-image-open-settings' }, imageWorkbenchOrigin)
}

onMounted(() => {
  window.addEventListener('message', onMessage)
  void loadKeys()
})
onUnmounted(() => {
  version++
  clearTimeout(timeout)
  clearTimeout(loadRetry)
  window.removeEventListener('message', onMessage)
})
</script>

<style scoped>
.image-studio {
  background: #f8f8f6;
}

.image-studio-toolbar {
  background: #fff;
  border-color: #e7e7e2;
  row-gap: 12px;
}

.image-studio-toolbar :deep(.select-trigger),
.image-studio-toolbar summary,
.image-studio-toolbar > button {
  border-radius: 999px;
}

.image-studio-toolbar summary,
.image-studio-toolbar > button {
  background: #f6f6f3;
  padding: 10px 14px;
}

.image-studio-toolbar summary:hover,
.image-studio-toolbar > button:hover {
  background: #edeee9;
}

#drawing-group-help {
  border-left: 1px solid #e7e7e2;
  padding-left: 16px;
}

:global(.dark .image-studio) {
  background: #181a18;
}

:global(.dark .image-studio-toolbar) {
  background: #232623;
  border-color: #393e37;
}

:global(.dark .image-studio-toolbar summary),
:global(.dark .image-studio-toolbar > button) {
  background: #2c302b;
}

:global(.dark .image-studio-toolbar summary:hover),
:global(.dark .image-studio-toolbar > button:hover) {
  background: #393e37;
}

:global(.dark .image-studio #drawing-group-help) {
  border-color: #393e37;
}

@media (max-width: 1023px) {
  #drawing-group-help {
    border-left: 0;
    padding-left: 0;
  }
}
</style>
