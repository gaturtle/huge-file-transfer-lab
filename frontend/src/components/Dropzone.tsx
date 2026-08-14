import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export interface DropzoneProps {
  onFile: (file: File) => void
  disabled?: boolean
  label?: string
}

/** Plain <input type="file"> with drag-and-drop, styled with shadcn primitives — no react-dropzone. */
export function Dropzone({ onFile, disabled, label = 'Drop a file here, or click to browse' }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) inputRef.current?.click()
      }}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setIsDragOver(true)
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setIsDragOver(false)
        const file = e.dataTransfer.files[0]
        if (file && !disabled) onFile(file)
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center text-sm text-muted-foreground transition-colors',
        isDragOver ? 'border-primary bg-accent' : 'border-input',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          e.target.value = ''
        }}
      />
      {label}
    </div>
  )
}
