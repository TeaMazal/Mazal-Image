import { lazy, Suspense, useEffect, useState } from 'react'
import './studio.css'
import './templateLibrary.css'
import { initStore, useStore, addImageFromUrl } from './store'
import { createMazalSettings } from './lib/mazalConfig'
import { normalizeParamsForSettings } from './lib/paramCompatibility'
import { useColorMode } from './hooks/useColorMode'
import { useVisibleTasks } from './hooks/usePrivacyMode'
import { getPageScroller } from './lib/pageScroll'
import { isMazalEmbedded, getMazalKey } from './lib/mazalSession'
import StudioSidebar from './components/StudioSidebar'
import StudioThread from './components/StudioThread'
import StudioCompletionNotice from './components/StudioCompletionNotice'
import { useGlobalClickSuppression } from './lib/clickSuppression'
import MazalHeader from './components/MazalHeader'
import MazalSettings from './components/MazalSettings'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import InputBar from './components/InputBar'
import DetailModal from './components/DetailModal'
import Lightbox from './components/Lightbox'
import ConfirmDialog from './components/ConfirmDialog'
import DataProgressDialog from './components/DataProgressDialog'
import Toast from './components/Toast'
import DbBlockedNotice from './components/DbBlockedNotice'
import MaskEditorModal from './components/MaskEditorModal'
import SketchBoardModal from './components/SketchBoardModal'
import ImageContextMenu from './components/ImageContextMenu'
import { FavoriteCollectionPickerModal, FavoriteCollectionsView, ManageCollectionsModal } from './components/FavoriteCollections'

const TemplateGallery = lazy(() => import('./components/TemplateGallery'))
let initialization: Promise<void> | null = null
let bridgeImportStarted = false

export default function App() {
  const filterFavorite = useStore((state) => state.filterFavorite)
  const activeFavoriteCollectionId = useStore((state) => state.activeFavoriteCollectionId)
  const privacyModeEpoch = useStore((state) => state.privacyModeEpoch)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const view = useStore((state) => state.studioView)
  const activeId = useStore((state) => state.activeStudioConversationId)
  const createConversation = useStore((state) => state.createStudioConversation)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const tasks = useVisibleTasks()
  const imageCount = tasks.reduce((count, task) => count + task.outputImages.length, 0)
  useColorMode()
  useGlobalClickSuppression()

  useEffect(() => {
    if (!ready) return
    if (view !== 'create') getPageScroller().scrollTo({ top: 0 })
    useStore.getState().clearSelection()
    setSidebarOpen(false)
  }, [view, ready])

  useEffect(() => {
    if (!initialization) {
      const state = useStore.getState()
      const settings = createMazalSettings(state.settings)
      state.setSettings(settings)
      useStore.setState({ appMode: 'gallery', supportPromptDismissed: true, supportPromptOpen: false, params: normalizeParamsForSettings(state.params, settings) })
      initialization = initStore()
    }
    void initialization.then(() => { useStore.getState().initializeStudioConversations(); setReady(true) }).catch(() => setError('无法打开本地作品库。请检查浏览器存储权限，或尝试退出隐私浏览模式后重试。'))
  }, [])

  useEffect(() => {
    if (!ready || bridgeImportStarted) return
    const asset = new URLSearchParams(location.search).get('canvasAsset')
    if (!asset || !/^[a-f0-9]{64}$/.test(asset)) return
    bridgeImportStarted = true
    void fetch('/api/canvas/assets/' + asset, { cache: 'no-store', headers: { Authorization: 'Bearer ' + getMazalKey() } }).then(async (response) => {
      if (!response.ok) throw new Error('无法读取画布作品，请确认仍使用同一用户的密钥')
      const url = URL.createObjectURL(await response.blob())
      try {
        useStore.getState().createStudioConversation()
        await addImageFromUrl(url)
        useStore.getState().setStudioView('create')
        history.replaceState(null, '', '/')
        useStore.getState().showToast('画布作品已加入参考图', 'success')
      } finally { URL.revokeObjectURL(url) }
    }).catch((failure) => useStore.getState().showToast(String(failure), 'error'))
  }, [ready])

  useEffect(() => {
    const prevent = (event: DragEvent) => {
      if ((event.target as HTMLElement | null)?.closest('img')) event.preventDefault()
    }
    document.addEventListener('dragstart', prevent)
    return () => document.removeEventListener('dragstart', prevent)
  }, [])

  if (error) return <main className="max-w-md mx-auto p-8 text-sm"><p role="alert">{error}</p><button className="text-blue-600 mt-4" onClick={() => location.reload()}>重新加载</button></main>
  if (!ready) return <div className="p-10 text-sm text-gray-500" role="status">正在打开你的创作空间…</div>

  return <div className={`studio${isMazalEmbedded ? ' studio-embedded' : ''}`} data-studio-view={view}>
    <div data-page-scroll>
      <MazalHeader />
      {view === 'create' && <StudioSidebar open={sidebarOpen} close={() => setSidebarOpen(false)} />}
      <main data-home-main data-drag-select-surface className="studio-main">
        {view === 'templates' ? <Suspense fallback={<p className="studio-template-status">正在打开灵感模板…</p>}><TemplateGallery /></Suspense> : view === 'create' ? <StudioThread openSidebar={() => setSidebarOpen(true)} /> : <section className="studio-gallery">
          <div className="studio-gallery-intro"><div><p className="studio-eyebrow">{view === 'favorites' ? '留住值得反复看的画面' : `${imageCount} 张图片，每一张都有来处`}</p><h1>{view === 'favorites' ? '你的收藏夹' : '作品画廊'}</h1><p>{view === 'favorites' ? '按主题整理灵感，随时回到原对话继续创作。' : '浏览所有对话的作品，找到灵感，再继续下一轮。'}</p></div><button className="studio-gallery-create" onClick={() => createConversation()}>＋ 新建对话</button></div>
          <SearchBar studio />
          {filterFavorite && !activeFavoriteCollectionId ? <FavoriteCollectionsView /> : <TaskGrid onlyOutputs />}
        </section>}
      </main>
    </div>
    {view !== 'templates' && <InputBar key={`input-${privacyModeEpoch}-${activeId}`} />}
    <DetailModal key={`detail-${privacyModeEpoch}`} />
    <Lightbox key={`lightbox-${privacyModeEpoch}`} />
    <MazalSettings />
    <DataProgressDialog />
    <ConfirmDialog />
    <FavoriteCollectionPickerModal />
    <ManageCollectionsModal />
    <Toast />
    <StudioCompletionNotice />
    <DbBlockedNotice />
    <MaskEditorModal key={`mask-${privacyModeEpoch}`} />
    <SketchBoardModal key={`sketch-${privacyModeEpoch}`} />
    <ImageContextMenu key={`menu-${privacyModeEpoch}`} />
  </div>
}
