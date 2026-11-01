import { useStore } from '../store'

export default function StudioNavigation() {
  const view = useStore((state) => state.studioView)
  const setView = useStore((state) => state.setStudioView)
  return <nav className="studio-navigation" aria-label="用户工作台导航">
    {([['create', '创作空间'], ['templates', '灵感模板'], ['gallery', '作品画廊'], ['favorites', '收藏夹']] as const).map(([id, label]) => <button key={id} data-active={view === id} aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>{label}</button>)}
    <a href="/canvas/" className="inline-flex items-center px-3 text-sm">无限画布 ↗</a>
    <a href="/canvas/library" className="inline-flex items-center px-3 text-sm">云端作品</a>
  </nav>
}
