import {
  Children,
  Fragment,
  forwardRef,
  isValidElement,
  useId,
  useMemo,
} from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cx } from '../utils'
import { Dropdown, DropdownItem } from './Dropdown'

function FieldShell({ label, helperText, error, htmlFor, children }) {
  return (
    <div className="ft-field">
      {label && (
        <label className="ft-field-label" htmlFor={htmlFor}>{label}</label>
      )}
      {children}
      {(error || helperText) && (
        <div className={cx('ft-field-helper', error && 'ft-field-helper--error')}>
          {error || helperText}
        </div>
      )}
    </div>
  )
}

export const Input = forwardRef(function Input({
  label,
  helperText,
  error,
  id,
  className,
  style,
  ...props
}, ref) {
  const autoId = useId()
  const inputId = id || autoId
  return (
    <FieldShell label={label} helperText={helperText} error={error} htmlFor={inputId}>
      <input
        ref={ref}
        id={inputId}
        className={cx('ft-control', error && 'ft-control--error', className)}
        style={style}
        aria-invalid={error ? true : undefined}
        {...props}
      />
    </FieldShell>
  )
})

function flattenSelectChildren(children, out = []) {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    if (child.type === 'option') {
      out.push(child)
      return
    }
    // Compact filters may pass a Fragment; unwrap so options are visible.
    if (child.type === Fragment) {
      flattenSelectChildren(child.props.children, out)
    }
  })
  return out
}

function readSelectOptions(children) {
  return flattenSelectChildren(children).map((child) => ({
    value: child.props.value == null ? '' : String(child.props.value),
    label: child.props.children,
    disabled: Boolean(child.props.disabled),
  }))
}

export const Select = forwardRef(function Select({
  label,
  helperText,
  error,
  id,
  className,
  style,
  children,
  value,
  defaultValue,
  onChange,
  name,
  disabled,
}, ref) {
  const autoId = useId()
  const inputId = id || autoId
  const options = useMemo(() => readSelectOptions(children), [children])
  const selectedValue = value != null ? String(value) : String(defaultValue ?? '')
  const selected = options.find((opt) => opt.value === selectedValue) || options[0]

  const emitChange = (nextValue) => {
    if (!onChange) return
    onChange({
      target: { name, value: nextValue },
      currentTarget: { name, value: nextValue },
    })
  }

  return (
    <FieldShell label={label} helperText={helperText} error={error} htmlFor={inputId}>
      <Dropdown
        className="ft-dropdown--block ft-select"
        menuClassName="ft-dropdown-menu--stretch"
        trigger={(
          <button
            type="button"
            id={inputId}
            disabled={disabled}
            className={cx(
              'ft-control',
              'ft-select-trigger',
              error && 'ft-control--error',
              className,
            )}
            style={style}
            aria-invalid={error ? true : undefined}
          >
            <span className="ft-select-trigger-label">
              {selected?.label ?? ''}
            </span>
            <ChevronDown size={16} className="ft-select-chevron" aria-hidden />
          </button>
        )}
      >
        {(close) => options.map((opt) => (
          <DropdownItem
            key={`${opt.value}::${typeof opt.label === 'string' ? opt.label : opt.value}`}
            className={opt.value === selectedValue ? 'ft-dropdown-item--active' : undefined}
            disabled={opt.disabled}
            onClick={() => {
              emitChange(opt.value)
              close()
            }}
          >
            {opt.label}
          </DropdownItem>
        ))}
      </Dropdown>
      {name != null && (
        <input
          ref={ref}
          type="hidden"
          name={name}
          value={selectedValue}
          readOnly
        />
      )}
    </FieldShell>
  )
})

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  className,
  ...props
}) {
  return (
    <label className={cx('ft-check', className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        {...props}
      />
      <span className="ft-check-box" aria-hidden>
        <Check size={11} strokeWidth={3} />
      </span>
      {label && <span>{label}</span>}
    </label>
  )
}

export function Switch({
  label,
  checked,
  onChange,
  disabled,
  className,
  ...props
}) {
  return (
    <label className={cx('ft-switch', className)}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        {...props}
      />
      <span className="ft-switch-track">
        <span className="ft-switch-thumb" />
      </span>
      {label && <span>{label}</span>}
    </label>
  )
}
