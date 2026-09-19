import { useEffect, useId, useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { Avatar } from '../../shared/components'
import { userPicSrc } from '../utils/userPic'
import './user-photo-field.css'

const UserPhotoField = ({
  label = 'Profile photo',
  name,
  currentSrc,
  file,
  onChange,
  changeLabel = 'Change photo',
  addLabel = 'Add photo',
}) => {
  const inputId = useId()
  const inputRef = useRef(null)
  const [previewUrl, setPreviewUrl] = useState(null)

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return undefined
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const src = previewUrl || userPicSrc(currentSrc)
  const hasPhoto = Boolean(src)
  const buttonLabel = hasPhoto ? changeLabel : addLabel

  return (
    <div className="upf-field">
      <span className="ft-field-label">{label}</span>
      <div className="upf-row">
        <Avatar name={name || 'User'} src={src} size="xl" className="upf-avatar" />
        <div className="upf-meta">
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="upf-input"
            onChange={(event) => onChange(event.target.files?.[0] || null)}
          />
          <button
            type="button"
            className="upf-btn"
            onClick={() => inputRef.current?.click()}
          >
            <Camera size={14} />
            {buttonLabel}
          </button>
          <span className="upf-hint">JPG, PNG or WebP · max 5MB</span>
        </div>
      </div>
    </div>
  )
}

export default UserPhotoField
