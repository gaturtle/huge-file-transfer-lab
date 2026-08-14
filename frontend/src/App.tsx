import { DownloadPanel } from '@/components/DownloadPanel'
import { UploadPanel } from '@/components/UploadPanel'

export function App() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">Huge File Transfer</h1>
      <UploadPanel />
      <DownloadPanel />
    </div>
  )
}
