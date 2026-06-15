import { History, Plus, Trash2, X, MessageSquare, Crown } from 'lucide-react'
import { useApp } from '../store/app'

export function ConversationDrawer(): JSX.Element | null {
  const open = useApp((s) => s.historyOpen)
  const setOpen = useApp((s) => s.setHistoryOpen)
  const list = useApp((s) => s.convList)
  const convId = useApp((s) => s.convId)
  const member = useApp((s) => s.account?.quota.memberActive)
  const newConversation = useApp((s) => s.newConversation)
  const openConversation = useApp((s) => s.openConversation)
  const deleteConversation = useApp((s) => s.deleteConversation)
  const setNeedRecharge = useApp((s) => s.setNeedRecharge)

  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setOpen(false)} />
      <div className="fixed left-0 top-0 bottom-0 z-50 w-72 bg-panel border-r border-edge flex flex-col p-3">
        <div className="flex items-center gap-2 mb-3">
          <History size={18} className="text-brand" />
          <span className="font-medium flex-1">历史对话</span>
          <button className="text-gray-400 hover:text-gray-200" onClick={() => setOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <button className="btn-soft w-full mb-3" onClick={() => newConversation()}>
          <Plus size={15} /> 新对话
        </button>
        {member ? (
          <div className="flex-1 overflow-auto -mx-1 px-1">
            {list.length === 0 && <p className="text-sm text-gray-500 text-center py-8">还没有历史对话</p>}
            {list.map((c) => (
              <div
                key={c.id}
                onClick={() => openConversation(c.id)}
                className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm cursor-pointer ${c.id === convId ? 'bg-brand/20 text-white' : 'text-gray-300 hover:bg-white/5'}`}
              >
                <MessageSquare size={14} className="text-gray-400 shrink-0" />
                <span className="flex-1 truncate">{c.title || '新对话'}</span>
                <button
                  className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400"
                  onClick={(e) => { e.stopPropagation(); deleteConversation(c.id) }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 grid place-items-center text-center px-4">
            <div>
              <Crown size={28} className="text-amber-300 mx-auto mb-2" />
              <p className="text-sm text-gray-300">多对话历史是<span className="text-brand">会员专享</span></p>
              <p className="text-xs text-gray-500 mt-1 mb-3">开通会员后可保存、切换多段历史对话</p>
              <button className="btn-primary" onClick={() => { setOpen(false); setNeedRecharge(true) }}>
                去开通会员
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
