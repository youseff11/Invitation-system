import {
  AlignBody,
  ColorBody,
  FontBody,
  IconBody,
  NumberBody,
  RangeBody,
  SelectBody,
  TextAreaBody,
  TextBody,
  ToggleBody,
} from './basic'
import { ListBody } from './ListField'
import { MediaField } from './media'
import { registerField } from './registry'

// تسجيل أنواع السكيما. أي نوع مش هنا بيرجع لحقل نص (زي ‎gradient‎).
registerField('text', TextBody)
registerField('url', TextBody)
registerField('date', TextBody)
registerField('datetime', TextBody)
registerField('gradient', TextBody)
registerField('textarea', TextAreaBody)
registerField('html', TextAreaBody)
registerField('number', NumberBody)
registerField('range', RangeBody)
registerField('color', ColorBody)
registerField('select', SelectBody)
registerField('font', FontBody)
registerField('icon', IconBody)
registerField('align', AlignBody)
registerField('toggle', ToggleBody)
registerField('image', MediaField)
registerField('media', MediaField)
registerField('list', ListBody)

export { FieldRenderer, registerField } from './registry'
export type { FieldProps } from './registry'
