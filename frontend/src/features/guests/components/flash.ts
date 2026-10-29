/** رسالة قصيرة فوق الصفحة (بديل رسائل Django بعد كل إجراء). */
export interface Flash {
  kind: 'success' | 'error'
  text: string
}
