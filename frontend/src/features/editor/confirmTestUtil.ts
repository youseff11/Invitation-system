import { fireEvent, screen, within } from '@testing-library/react'

/** يجاوب على حوار التأكيد بتاع المحرر (الزرار الأول إلغاء والتاني تأكيد). */
export async function answerConfirm(ok: boolean) {
  const buttons = within(await screen.findByRole('alertdialog')).getAllByRole('button')
  fireEvent.click(buttons[ok ? 1 : 0])
}
