export const NEW_USER_PASSWORD_MIN_LENGTH = 8

export const newUserPasswordChecks = (password) => ({
  minLength: password.length >= NEW_USER_PASSWORD_MIN_LENGTH,
  uppercase: /[A-Z]/.test(password),
  lowercase: /[a-z]/.test(password),
  number: /\d/.test(password),
})

export const isNewUserPasswordValid = (password) => {
  const checks = newUserPasswordChecks(password)
  return checks.minLength && checks.uppercase && checks.lowercase && checks.number
}
