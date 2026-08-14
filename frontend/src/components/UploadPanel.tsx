import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Dropzone } from './Dropzone'
import { useUploadTransfer } from '@/hooks/useUploadTransfer'
import { formatBytes } from '@/lib/format'

export function UploadPanel() {
  const upload = useUploadTransfer()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload</CardTitle>
        <CardDescription>Select a file to upload in resumable 8MiB chunks.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {upload.phase === 'idle' && <Dropzone onFile={upload.pickFile} />}

        {upload.phase === 'resume-prompt' && upload.file && (
          <Alert>
            <AlertTitle>Resume previous upload?</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>
                A previous, incomplete upload of <strong>{upload.file.name}</strong> was found.
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void upload.resumePrevious()}>
                  Resume
                </Button>
                <Button size="sm" variant="outline" onClick={() => void upload.startNew()}>
                  Start over
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {upload.phase === 'hashing' && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Computing checksum before upload starts…</p>
            <Progress value={upload.hashProgress * 100} />
          </div>
        )}

        {upload.phase === 'transferring' && upload.file && (
          <div className="space-y-3">
            <p className="text-sm">
              {upload.file.name} — {formatBytes(upload.transfer.bytesTransferred)} / {formatBytes(upload.transfer.totalSize)}
            </p>
            <Progress value={upload.transfer.progress * 100} />

            {upload.transfer.status === 'error' && (
              <Alert variant="destructive">
                <AlertTitle>Upload error</AlertTitle>
                <AlertDescription>{upload.transfer.error}</AlertDescription>
              </Alert>
            )}

            <div className="flex gap-2">
              {upload.transfer.status !== 'transferring' && upload.transfer.status !== 'completed' && (
                <Button size="sm" onClick={upload.transfer.start}>
                  {upload.transfer.status === 'paused' ? 'Resume' : 'Start'}
                </Button>
              )}
              {upload.transfer.status === 'transferring' && (
                <Button size="sm" variant="outline" onClick={upload.transfer.pause}>
                  Pause
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={upload.transfer.cancel}>
                Cancel
              </Button>
            </div>

            {upload.transfer.status === 'completed' && (
              <Alert>
                <AlertTitle>Upload complete</AlertTitle>
                <AlertDescription>{upload.file.name} was uploaded and verified.</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {upload.phase === 'error' && (
          <Alert variant="destructive">
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>{upload.error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
