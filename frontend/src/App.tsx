import { useEffect, useState } from 'react'
import { initStore, useStore } from './store'
import { createMazalSettings } from './lib/mazalConfig'
import { normalizeParamsForSettings } from './lib/paramCompatibility'
import { useColorMode } from './hooks/useColorMode'
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

let initialization: Promise<void> | null = null

export default function App() {
  const filterFavorite = useStore((state) => state.filterFavorite)
  const activeFavoriteCollectionId = useStore((state) => state.activeFavoriteCollectionId)
  const privacyModeEpoch = useStore((state) => state.privacyModeEpoch)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  useColorMode()
  useGlobalClickSuppression()

  useEffect(() => {
    if (!initialization) {
      const state = useStore.getState()
      const settings = createMazalSettings(state.settings)
      state.setSettings(settings)
      useStore.setState({ appMode: 'gallery', supportPromptDismissed: true, supportPromptOpen: false, params: normalizeParamsForSettings(state.params, settings) })
      initialization = initStore()
    }
    void initialization.then(() => setReady(true)).catch(() => setError('无法打开本地作品库。请检查浏览器存储权限，或尝试退出隐私浏览模式后重试。'))
  }, [])

  useEffect(() => {
    const prevent = (event: DragEvent) => {
      if ((event.target as HTMLElement | null)?.closest('img')) event.preventDefault()
    }
    document.addEventListener('dragstart', prevent)
    return () => document.removeEventListener('dragstart', prevent)
  }, [])

  if (error) return <main className="max-w-md mx-auto p-8 text-sm"><p role="alert">{error}</p><button className="text-blue-600 mt-4" onClick={() => location.reload()}>重新加载</button></main>
  if (!ready) return <div className="p-10 text-sm text-gray-500" role="status">正在打开你的创作空间…</div>

  return <>
    <div data-page-scroll>
      <MazalHeader />
      <main data-home-main data-drag-select-surface className="pb-48">
        <div className="safe-area-x max-w-7xl mx-auto">
          <SearchBar />
          {filterFavorite && !activeFavoriteCollectionId ? <FavoriteCollectionsView /> : <TaskGrid />}
        </div>
      </main>
    </div>
    <InputBar key={`input-${privacyModeEpoch}`} />
    <DetailModal key={`detail-${privacyModeEpoch}`} />
    <Lightbox key={`lightbox-${privacyModeEpoch}`} />
    <MazalSettings />
    <DataProgressDialog />
    <ConfirmDialog />
    <FavoriteCollectionPickerModal />
    <ManageCollectionsModal />
    <Toast />
    <DbBlockedNotice />
    <MaskEditorModal key={`mask-${privacyModeEpoch}`} />
    <SketchBoardModal key={`sketch-${privacyModeEpoch}`} />
    <ImageContextMenu key={`menu-${privacyModeEpoch}`} />
  </>
}
