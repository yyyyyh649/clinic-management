// PhoneInput (C.1): realtime phone validation.
//   - digits only (strip non-digits as you type)
//   - first digit must be 1 (block otherwise)
//   - max 11 digits (stop accepting beyond 11)
//   - show "手机号格式错误" below the input when invalid (not 11 digits or not starting with 1)
//   - expose the current validity via a callback so parents can gate submit.
import React from 'react';
import { Input } from './ui';

export function isPhoneValid(phone: string): boolean {
  return /^1\d{10}$/.test(phone);
}

export const PhoneInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & {
    onValidChange?: (phone: string, valid: boolean) => void;
  }
>(function PhoneInput({ value, onChange, onValidChange, ...rest }, ref) {
  const phone = String(value ?? '');
  const valid = isPhoneValid(phone);
  // invalid if non-empty AND (not starting with 1, or not 11 digits yet but >0 digits)
  const showError = phone.length > 0 && !valid;

  function handle(e: React.ChangeEvent<HTMLInputElement>) {
    // strip non-digits
    let digits = e.target.value.replace(/\D/g, '');
    // first digit must be 1; if user typed something else first, drop leading non-1 digits
    if (digits.length > 0 && digits[0] !== '1') {
      // keep only digits after the first '1' if any, else empty
      const idx = digits.indexOf('1');
      digits = idx >= 0 ? digits.slice(idx) : '';
    }
    // cap at 11
    if (digits.length > 11) digits = digits.slice(0, 11);
    const synthetic = { ...e, target: { ...e.target, value: digits } } as any;
    onChange?.(synthetic);
    onValidChange?.(digits, isPhoneValid(digits));
  }

  return (
    <div>
      <Input
        ref={ref}
        value={phone}
        onChange={handle}
        inputMode="numeric"
        maxLength={11}
        placeholder="请输入11位手机号"
        {...rest}
      />
      {showError && (
        <span className="mt-1 block text-xs text-rose-600">手机号格式错误（需11位、第一位为1）</span>
      )}
    </div>
  );
});
