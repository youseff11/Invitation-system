import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { initI18n } from '@/i18n'
import { ConfirmProvider, useConfirm } from './ConfirmDialog'

function Asker({ onAnswer }: { onAnswer: (ok: boolean) => void }) {
  const confirm = useConfirm()
  return (
    <button
      onClick={async () => onAnswer(await confirm({ message: 'تحذف «دعوة» نهائياً؟', danger: true, confirmLabel: 'حذف' }))}
    >
      ask
    </button>
  )
}

function setup() {
  const onAnswer = vi.fn()
  render(
    <ConfirmProvider>
      <Asker onAnswer={onAnswer} />
    </ConfirmProvider>,
  )
  fireEvent.click(screen.getByText('ask'))
  return onAnswer
}

beforeAll(() => {
  initI18n('ar')
})

describe('ConfirmDialog', () => {
  it('shows the message and resolves true on confirm', async () => {
    const onAnswer = setup()
    expect(screen.getByRole('alertdialog')).toHaveTextContent('تحذف «دعوة» نهائياً؟')
    fireEvent.click(screen.getByRole('button', { name: 'حذف' }))
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(true))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('resolves false on cancel', async () => {
    const onAnswer = setup()
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }))
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false))
  })

  it('resolves false on Escape and on clicking the backdrop', async () => {
    let onAnswer = setup()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false))

    cleanup()
    onAnswer = setup()
    const veil = document.querySelector('.dash-dialog-veil') as HTMLElement
    fireEvent.mouseDown(veil)
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false))
  })

  it('focuses the confirm button when it opens', () => {
    setup()
    expect(screen.getByRole('button', { name: 'حذف' })).toHaveFocus()
  })

  it('throws a helpful error outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Asker onAnswer={() => {}} />)).toThrow(/ConfirmProvider/)
    spy.mockRestore()
  })
})
