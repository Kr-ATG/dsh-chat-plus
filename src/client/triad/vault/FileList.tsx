/**
 * 文件附件区 —— 档案详情抽屉里的「配置文件 / 订阅 / 证书」列表。
 *
 * ── 为什么文件不进照片区 ──────────────────────────────────────────────
 * 照片是图片（有缩略图、大图、三档压缩）；文件是原样字节（Clash 订阅
 * YAML、Xray config、SSH 证书、脚本）。混在一起会让「点开看大图」的交互
 * 套到一个 YAML 上，还会把文件误压成 JPEG。两者共用的只有底下的 blobs 树。
 *
 * ── 为什么上传要串行 ──────────────────────────────────────────────────
 * 与照片同理：并行上传只是把带宽切成更难看的锯齿；而且每个文件上传都会
 * 回一条新的 record（带新的变更历史），并发合并容易丢历史。
 */

import { useRef, useState } from 'react'
import type { ChangeEvent, JSX } from 'react'
import type { VaultRecord } from '../../../triad/vault/types.js'
import {
  deleteVaultFile,
  fileToBase64,
  formatVaultBytes,
  uploadVaultFileDetailed,
  vaultFileUrl,
} from './api.js'
import { css } from './styles.js'
import { DownloadIcon, RecordIcon, TrashIcon, UploadIcon } from './icons.js'

/** 单文件大小上限（与宿主 MAX_BLOB_BYTES 一致，前端先拦一次省一次往返）。 */
const MAX_FILE_BYTES = 20 * 1024 * 1024

export interface VaultFileListProps {
  record: VaultRecord
  /** 记录更新回调（上传 / 删除后宿主会回整条记录）。 */
  onRecord: (record: VaultRecord) => void
  /** 错误上报（父级统一显示在抽屉里）。 */
  onError: (message: string) => void
}

export function VaultFileList({ record, onRecord, onError }: VaultFileListProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState<string>('')
  const [deleting, setDeleting] = useState<string>('')
  const files = Array.isArray(record.files) ? record.files : []
  const unsaved = record.id === ''

  const onPick = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const picked = Array.from(event.target.files ?? [])
    // 不清空的话「再选同一个文件」不会触发 change。
    event.target.value = ''
    if (picked.length === 0) return
    let latest = record
    for (let index = 0; index < picked.length; index += 1) {
      const file = picked[index]
      if (file.size > MAX_FILE_BYTES) {
        onError('「' + file.name + '」超过单文件上限（20MB），没有上传')
        continue
      }
      setUploading(picked.length > 1
        ? '正在上传第 ' + String(index + 1) + ' / ' + String(picked.length) + ' 个文件…'
        : '正在上传…')
      try {
        const data = await fileToBase64(file)
        const uploaded = await uploadVaultFileDetailed({
          id: record.id,
          name: file.name,
          mimeType: file.type !== '' ? file.type : 'application/octet-stream',
          data,
        })
        latest = uploaded.record !== null
          ? uploaded.record
          : { ...latest, files: [...(latest.files ?? []), uploaded.file] }
      } catch (error) {
        onError('文件上传失败：' + (error instanceof Error ? error.message : String(error)))
        break
      }
    }
    setUploading('')
    if (latest !== record) onRecord(latest)
  }

  const onDelete = async (fileId: string): Promise<void> => {
    if (!window.confirm('删除这个文件附件？')) return
    setDeleting(fileId)
    try {
      const next = await deleteVaultFile(record.id, fileId)
      onRecord(next)
    } catch (error) {
      onError('删除文件失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setDeleting('')
    }
  }

  return (
    <div className={css.fileList} data-role="file-list" data-empty={files.length === 0 ? '1' : '0'}>
      {files.length === 0 && (
        <div className={css.fileHint} data-role="empty">还没有文件附件。配置文件、订阅、证书都可以放进来。</div>
      )}

      {files.map((file) => (
        <div key={file.id} className={css.fileRow} data-role="file-row">
          <span className={css.fileIcon}><RecordIcon size={15} /></span>
          <span className={css.fileMain}>
            <span className={css.fileName} title={file.name}>{file.label !== undefined && file.label !== '' ? file.label : file.name}</span>
            <span className={css.fileMeta}>
              {file.label !== undefined && file.label !== '' && file.label !== file.name ? file.name + ' · ' : ''}
              {formatVaultBytes(file.bytes)}
            </span>
          </span>
          <a
            className={css.fileAction}
            href={vaultFileUrl(file.sha256, file.name)}
            download={file.name}
            title={'下载 ' + file.name}
            aria-label={'下载 ' + file.name}
          >
            <DownloadIcon size={13} />
          </a>
          <button
            type="button"
            className={css.fileDelete}
            aria-label={'删除文件 ' + file.name}
            title="删除这个文件附件"
            disabled={deleting === file.id}
            onClick={() => { void onDelete(file.id) }}
          >
            <TrashIcon size={12} />
          </button>
        </div>
      ))}

      {unsaved ? (
        <div className={css.fileHint}>先点下面的「创建」保存这条记录，再上传文件。</div>
      ) : (
        <button
          type="button"
          className={css.fileUpload}
          data-role="file-upload"
          onClick={() => { inputRef.current?.click() }}
          disabled={uploading !== ''}
          title="上传配置文件、订阅或其它任意文件（单文件 20MB 内）"
        >
          <UploadIcon size={14} />
          <span>{uploading !== '' ? uploading : '上传文件'}</span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(event) => { void onPick(event) }}
      />
    </div>
  )
}
