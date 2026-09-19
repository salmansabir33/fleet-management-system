import { useEffect, useState } from 'react'
import { Bike, Car, Truck } from 'lucide-react'
import { cx } from '../../shared/utils'

const TYPE_ICON = {
  truck: Truck,
  van: Truck,
  car: Car,
  bike: Bike,
  motorcycle: Bike,
}

export default function VehicleHeroArt({
  vehicleType,
  plate,
  size = 'hero',
  className,
  src,
}) {
  const Icon = TYPE_ICON[(vehicleType || '').toLowerCase()] || Car
  const isThumb = size === 'thumb'
  const [imgFailed, setImgFailed] = useState(false)
  const showPhoto = Boolean(src) && !imgFailed

  useEffect(() => {
    setImgFailed(false)
  }, [src])

  return (
    <div
      className={cx(
        'ft-vehicle-art',
        isThumb && 'ft-vehicle-art--thumb',
        size === 'card' && 'ft-vehicle-art--card',
        size === 'showcase' && 'ft-vehicle-art--showcase',
        className,
      )}
      aria-hidden
    >
      {showPhoto ? (
        <img
          src={src}
          alt=""
          className="ft-vehicle-art-photo"
          decoding="async"
          fetchPriority={size === 'showcase' ? 'high' : 'auto'}
          onError={() => setImgFailed(true)}
        />
      ) : (
        <Icon size={isThumb ? 18 : 56} strokeWidth={1.4} />
      )}
      {!isThumb && plate ? (
        <span className="ft-vehicle-art-plate">{plate}</span>
      ) : null}
    </div>
  )
}
