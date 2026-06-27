import { useEffect, useState } from 'react'
import { MessageSquareText, Wrench, Pencil, Settings as SettingsIcon, Sparkles, Crown, History, Plus, Images } from 'lucide-react'
import { useApp, type View } from './store/app'
import { Membership } from './components/Membership'
import { ConversationDrawer } from './components/ConversationDrawer'
import { UpdateModal } from './components/UpdateModal'
import { LoginView } from './views/LoginView'
import { ChatView } from './views/ChatView'
import { extractImages } from './lib/files'
import { ResourceLibrary } from './views/ResourceLibrary'
import { EditorView } from './views/EditorView'
import { SettingsView } from './views/SettingsView'
import { CloudGallery } from './views/CloudGallery'

const NAV: { key: View; label: string; icon: typeof Wrench }[] = [
  { key: 'chat', label: '对话生图', icon: MessageSquareText },
  { key: 'gallery', label: '云作品库', icon: Images },
  { key: 'library', label: '资源库', icon: Wrench },
  { key: 'editor', label: '编辑区', icon: Pencil },
  { key: 'settings', label: '设置', icon: SettingsIcon }
]

export default function App(): JSX.Element {
  const ready = useApp((s) => s.ready)
  const account = useApp((s) => s.account)
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const init = useApp((s) => s.init)
  const needRecharge = useApp((s) => s.needRecharge)
  const setNeedRecharge = useApp((s) => s.setNeedRecharge)
  const update = useApp((s) => s.update)
  const dismissUpdate = useApp((s) => s.dismissUpdate)
  const setHistoryOpen = useApp((s) => s.setHistoryOpen)
  const newConversation = useApp((s) => s.newConversation)
  const addPendingRefs = useApp((s) => s.addPendingRefs)
  const [showMember, setShowMember] = useState(false)

  useEffect(() => {
    init()
  }, [init])

  const updateModal = update ? <UpdateModal info={update} onClose={dismissUpdate} /> : null

  useEffect(() => {
    if (needRecharge) {
      setShowMember(true)
      setNeedRecharge(false)
    }
  }, [needRecharge, setNeedRecharge])

  if (!ready)
    return (
      <>
        {updateModal}
        <div className="h-full grid place-items-center text-gray-500">正在启动 Co-GPT…</div>
      </>
    )
  if (!account)
    return (
      <>
        {updateModal}
        <LoginView />
      </>
    )

  const q = account.quota
  // 余额单位已改为「点」（后端方案B：1 旧额度=10 点）。会员显示剩余点数；免费用户显示今日免费点数。
  const creditLabel = q.memberActive
    ? `${q.memberCredits} 点`
    : `免费 ${q.freeRemaining}/${q.freeDaily} 点`

  return (
    <div
      className="h-full flex app-bg"
      onDragOver={(e) => { if (view !== 'editor' && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault() }}
      onDrop={async (e) => {
        // 编辑区有自己的拖拽处理；其余任意位置拖入图片→自动作为参考图（聊天区由 ChatView 自行拦截处理）
        if (view === 'editor') return
        const imgs = await extractImages(e.dataTransfer)
        if (imgs.length) { e.preventDefault(); addPendingRefs(imgs) }
      }}
    >
      <nav className="w-[92px] shrink-0 bg-black/20 backdrop-blur border-r border-white/5 flex flex-col items-center py-4 gap-1.5">
        <div
          className="mb-4 w-11 h-11 rounded-2xl grid place-items-center text-white shadow-lg"
          style={{ background: 'linear-gradient(135deg,#8b7bff,#16a5c9)' }}
        >
          <Sparkles size={22} />
        </div>
        {NAV.map((n) => {
          const Active = n.key === view
          const Icon = n.icon
          return (
            <button
              key={n.key}
              onClick={() => setView(n.key)}
              className={`w-[74px] py-2.5 rounded-2xl flex flex-col items-center gap-1 text-[11px] transition-all ${
                Active ? 'text-white shadow-lg shadow-brand/30' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
              }`}
              style={Active ? { background: 'linear-gradient(135deg,#7b5cff,#9b5cff)' } : undefined}
            >
              <Icon size={20} />
              {n.label}
            </button>
          )
        })}
      </nav>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 border-b border-white/5 flex items-center gap-2 px-4">
          <button
            title="历史对话"
            onClick={() => setHistoryOpen(true)}
            className="w-8 h-8 grid place-items-center rounded-lg text-gray-300 hover:bg-white/10"
          >
            <History size={18} />
          </button>
          <button
            title="新对话"
            onClick={() => newConversation()}
            className="w-8 h-8 grid place-items-center rounded-lg text-gray-300 hover:bg-white/10"
          >
            <Plus size={18} />
          </button>
          <div className="text-sm text-gray-300 ml-1">
            {account.phone}
            {q.memberActive && <span className="ml-2 text-[10px] text-amber-300">会员 · {q.memberTier}</span>}
          </div>
          <button
            onClick={() => setShowMember(true)}
            className="ml-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white transition-transform hover:scale-[1.03]"
            style={{ background: 'linear-gradient(120deg,#7b5cff,#b06cff)' }}
            title="会员中心 / 充值"
          >
            <Crown size={14} className="text-amber-200" />
            额度 {creditLabel}
          </button>
        </header>
        <main className="flex-1 min-h-0">
          {view === 'chat' && <ChatView />}
          {view === 'gallery' && <CloudGallery />}
          {view === 'library' && <ResourceLibrary />}
          {view === 'editor' && <EditorView />}
          {view === 'settings' && <SettingsView />}
        </main>
      </div>

      {showMember && <Membership onClose={() => setShowMember(false)} />}
      <ConversationDrawer />
      {updateModal}
    </div>
  )
}
