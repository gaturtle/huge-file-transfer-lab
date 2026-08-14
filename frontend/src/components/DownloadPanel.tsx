import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { useDownloadTransfer } from '@/hooks/useDownloadTransfer'
import { formatBytes } from '@/lib/format'

export function DownloadPanel() {
  const download = useDownloadTransfer()
  const [uploadId, setUploadId] = useState('')
  const [filename, setFilename] = useState('')
  const [resumable, setResumable] = useState<{ uploadId: string; filename: string } | null>(null)

  if (!download.supported) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Download</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTitle>Unsupported browser</AlertTitle>
            <AlertDescription>Download requires Chrome or Edge (File System Access API).</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    )
  }

  const checkResumable = async (id: string) => {
    const record = await download.findResumable(id)
    setResumable(record ? { uploadId: record.uploadId, filename: record.filename } : null)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Download</CardTitle>
        <CardDescription>Enter the Upload Id of a completed upload to download it.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {download.phase === 'idle' && (
          <div className="space-y-2">
            <input
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
              placeholder="Upload Id"
              value={uploadId}
              onChange={(e) => {
                setUploadId(e.target.value)
                void checkResumable(e.target.value)
              }}
            />
            <input
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
              placeholder="Save as filename"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
            />

            {resumable && resumable.uploadId === uploadId ? (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void download.resumePrevious(uploadId)}>
                  Resume previous download
                </Button>
                <Button size="sm" variant="outline" onClick={() => void download.startNew(uploadId, filename || resumable.filename)}>
                  Start over
                </Button>
              </div>
            ) : (
              <Button size="sm" disabled={!uploadId || !filename} onClick={() => void download.startDownload(uploadId, filename)}>
                Choose save location &amp; start
              </Button>
            )}
          </div>
        )}

        {download.phase === 'preparing' && <p className="text-sm text-muted-foreground">Preparing download…</p>}

        {(download.phase === 'transferring' || download.phase === 'verifying' || download.phase === 'verified' || download.phase === 'mismatch') && (
          <div className="space-y-3">
            <p className="text-sm">
              {download.filename} — {formatBytes(download.transfer.bytesTransferred)} / {formatBytes(download.transfer.totalSize)}
            </p>
            <Progress value={download.transfer.progress * 100} />

            {download.transfer.status === 'error' && (
              <Alert variant="destructive">
                <AlertTitle>Download error</AlertTitle>
                <AlertDescription>{download.transfer.error}</AlertDescription>
              </Alert>
            )}

            {download.phase === 'transferring' && (
              <div className="flex gap-2">
                {download.transfer.status !== 'transferring' && (
                  <Button size="sm" onClick={download.transfer.start}>
                    {download.transfer.status === 'paused' ? 'Resume' : 'Start'}
                  </Button>
                )}
                {download.transfer.status === 'transferring' && (
                  <Button size="sm" variant="outline" onClick={download.transfer.pause}>
                    Pause
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={download.transfer.cancel}>
                  Cancel
                </Button>
              </div>
            )}

            {download.phase === 'verifying' && <p className="text-sm text-muted-foreground">Verifying checksum…</p>}

            {download.phase === 'verified' && (
              <Alert>
                <AlertTitle>Download complete</AlertTitle>
                <AlertDescription>{download.filename} was downloaded and verified.</AlertDescription>
              </Alert>
            )}

            {download.phase === 'mismatch' && (
              <Alert variant="destructive">
                <AlertTitle>Checksum mismatch</AlertTitle>
                <AlertDescription>The downloaded file didn't match the server's checksum.</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {download.phase === 'error' && (
          <Alert variant="destructive">
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>{download.error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
