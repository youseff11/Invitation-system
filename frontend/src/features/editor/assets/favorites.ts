import { insertBlock, newBlockId } from '../doc'
import { useEditor } from '../store'
import type { DocBlock, EditorSchema, FavoriteRow } from '../types'

export type AddResult = 'added' | 'invalid' | 'singleton'

/**
 * يضيف نسخة من القسم المفضّل بعد القسم المحدد بمعرّف جديد (زي ‎addFavoriteToDocument‎ القديمة):
 * مرفوض لو نوعه مابقاش في السكيما، أو قسم مفرد (‎singleton‎) موجود في المستند.
 */
export function addFavoriteToDocument(favorite: FavoriteRow, schema: EditorSchema): AddResult {
  const source = favorite.block
  const spec = source && typeof source.type === 'string' ? schema.blocks[source.type] : undefined
  if (!source || !spec) return 'invalid'

  const { doc, selected, commit } = useEditor.getState()
  if (spec.singleton && doc.blocks.some((b) => b.type === source.type)) return 'singleton'

  const copy = JSON.parse(JSON.stringify(source)) as DocBlock
  const block: DocBlock = { ...copy, id: newBlockId(source.type), props: copy.props ?? {}, style: copy.style ?? {} }
  commit((d) => insertBlock(d, block, selected))
  useEditor.setState({ selected: block.id, selectSource: 'list', tab: 'inspector' })
  return 'added'
}
