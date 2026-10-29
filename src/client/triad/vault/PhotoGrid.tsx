/**
 * 照片网格 —— 档案详情抽屉里的图片区（上传 / 缩略图 / 看大图 / 删除）。
 *
 * ── 为什么图片要三档而不是一张 ────────────────────────────────────────
 * 缩略图只在网格里出现（104px 宽的格子），展示图在点开时出现。宿主侧实测
 * 512 长边的缩略图约 30KB、1600 长边的展示图约 200KB，差一个数量级；网格里
 * 一次铺十几张大图会把「打开这个页面」变成一次几百 MB 的下载。
 * 所以网格只取 thumb（缺省才回落到 display），点开才取 display。
 *
 * ── 压缩为什么在客户端做 ─────────────────────────────────────────────
 * 见 api.ts 的 compressPhotoVariants：原图先上传再在服务端缩，等于把带宽与
 * 内存峰值付两遍。这里只负责「拿到文件 → 调压缩 → 上传」，压缩参数全部来自
 * 宿主配置（displayMaxEdge / thumbMaxEdge / imageQuality / keepOriginal），
 * 页面不自己另定一套数值。
 *
 * ── 为什么大图用 portal 到 body ──────────────────────────────────────
 * 抽屉有 transform 动画（translateX），动画期间它是子元素的包含块；而
 * position:fixed 的灯箱若留在抽屉内部，会被抽屉的 transform / overflow 裁掉
 * 或跟着抽屉一起滑，还会被困在抽屉的层叠上下文里。挂到 body 才是真正的满屏。
 */

import { useRef, useState } from 'react'
import type { ChangeEvent, JSX } from 'react'
import { createPortal } from 'react-dom'
import type { VaultConfig, VaultPhoto, VaultRecord } from '../../../triad/vault/types.js'
import {
  compressOptionsOf,
  compressPhotoVariants,
  deleteVaultPhoto,
  uploadVaultPhotoDetailed,
  vaultImageUrl,
} from './api.js'
import { css } from './styles.js'
import { CameraIcon, CloseIcon, TrashIcon } from './icons.js'

/** 照片网格属性。 */
export interface VaultPhotoGridProps {
  record: VaultRecord
  /** 该场景是否以照片为主（证件类）——上传入口要更显眼。 */
  photoFirst: boolean
  config: Partial<VaultConfig>
  /** 记录更新回调（上传 / 删除后宿主会回整条记录）。 */
  onRecord: (record: VaultRecord) => void
  /** 错误上报（父级统一显示在抽屉里，不在这里各画一份）。 */
  onError: (message: string) => void
}

/** 当前看大图的那张（null = 没开）。 */
interface LightboxState {
  photo: VaultPhoto
  /** display 档的 sha（缺省回落到 thumb）。 */
  sha: string
}

/**
 * 上传角色：证件类场景按「正面 / 背面 / 其它」轮着来。
 *
 * role 在宿主侧只作展示与排序提示（见 types.ts 的 VaultPhoto.role），但把
 * 第一张记成 front、第二张记成 back 能让「哪张是正面」在一眼之内成立，
 * 不用用户自己写标签。
 */
function roleOf(index: number, photoFirst: boolean): { role: string; label: string } {
  if (!photoFirst) return { role: 'extra', label: '照片' }
  if (index === 0) return { role: 'front', label: '正面' }
  if (index === 1) return { role: 'back', label: '背面' }
  return { role: 'extra', label: '附件' }
}

export function VaultPhotoGrid({
  record, photoFirst, config, onRecord, onError,
}: VaultPhotoGridProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState<string>('')
  const [lightbox, setLightbox] = useState<LightboxState | null>(null)
  const [deleting, setDeleting] = useState<string>('')

  const maxPhotos = typeof config.maxPhotosPerRecord === 'number' ? config.maxPhotosPerRecord : 12
  const full = record.photos.length >= maxPhotos
  /**
   * 还没落盘的草稿（新建态 id 为空）。
   *
   * /photo 的契约是「给一条已存在的记录挂照片」，没有 id 就无处可挂。所以草稿态
   * 把上传入口改成一句「先保存」的提示，而不是让用户点进去、选完图、压完图、
   * 最后才收到一个 404——那次压缩可能已经花了两秒。
   */
  const unsaved = record.id === ''

  /** 选完文件：逐张压缩 + 上传（串行——并行上传只会把带宽切成更难看的锯齿）。 */
  const onPick = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(event.target.files ?? [])
    // 立刻清空 input 的值：不清空的话「再选同一张图」不会触发 change，
    // 用户会以为上传按钮坏了。
    event.target.value = ''
    if (files.length === 0) return
    const options = compressOptionsOf(config)
    let latest = record
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]
      const target = roleOf(record.photos.length + index, photoFirst)
      setUploading(files.length > 1
        ? '正在压缩并上传第 ' + String(index + 1) + ' / ' + String(files.length) + ' 张…'
        : '正在压缩并上传…')
      try {
        const variants = await compressPhotoVariants(file, options)
        const uploaded = await uploadVaultPhotoDetailed({
          id: record.id,
          role: target.role,
          label: target.label + (files.length > 1 ? ' ' + String(index + 1) : ''),
          variants,
        })
        // 优先用宿主回的整条记录：它带着这次 photo-add 的变更历史与新的
        // version，本地拼凑出来的 photos 只有一半真相（历史缺一条）。
        // 旧宿主不回 record 时才退回本地副本。
        latest = uploaded.record !== null
          ? uploaded.record
          : { ...latest, photos: [...latest.photos, uploaded.photo] }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        onError('照片上传失败：' + reason)
        break
      }
    }
    setUploading('')
    if (latest !== record) onRecord(latest)
  }

  const onDelete = async (photo: VaultPhoto): Promise<void> => {
    setDeleting(photo.id)
    try {
      const next = await deleteVaultPhoto(record.id, photo.id)
      onRecord(next)
      if (lightbox !== null && lightbox.photo.id === photo.id) setLightbox(null)
    } catch (error) {
      onError('删除照片失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setDeleting('')
    }
  }

  return (
    <>
      <div className={css.photoGrid} data-role="photo-grid" data-empty={record.photos.length === 0 ? '1' : '0'}>
        {record.photos.map((photo) => {
          const thumb = photo.blobs.thumb ?? photo.blobs.display
          return (
            <div key={photo.id} className={css.photoCard} data-role="photo-card">
              <img
                className={css.photoThumb}
                src={vaultImageUrl(thumb.sha256)}
                alt={photo.label}
                loading="lazy"
                decoding="async"
                onClick={() => { setLightbox({ photo, sha: photo.blobs.display.sha256 }) }}
              />
              <div className={css.photoLabel} title={photo.label}>{photo.label}</div>
              <button
                type="button"
                className={css.photoDel}
                aria-label={'删除照片 ' + photo.label}
                title="删除这张照片"
                disabled={deleting === photo.id}
                onClick={() => { void onDelete(photo) }}
              >
                <TrashIcon size={12} />
              </button>
            </div>
          )
        })}

        {!full && (
          unsaved ? (
            <div className={css.photoUpload} data-role="photo-upload" data-unsaved="1" style={{ cursor: 'default' }}>
              <CameraIcon size={16} />
              <span>先点下面的「创建」保存这条记录，再上传照片</span>
            </div>
          ) : (
            <button
              type="button"
              className={photoFirst ? css.photoUpload + ' ' + css.photoUploadPri : css.photoUpload}
              data-role="photo-upload"
              onClick={() => { inputRef.current?.click() }}
              disabled={uploading !== ''}
              title={photoFirst ? '证件类场景：拍一张或选一张照片存进来' : '上传照片'}
            >
              <CameraIcon size={16} />
              <span>{uploading !== '' ? '处理中…' : photoFirst ? '拍照 / 上传' : '上传照片'}</span>
            </button>
          )
        )}

        {uploading !== '' && <div className={css.photoBusy} data-role="photo-busy">{uploading}</div>}

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(event) => { void onPick(event) }}
        />
      </div>

      {lightbox !== null && createPortal(
        (
          <div
            className={css.lightbox}
            data-role="lightbox"
            role="dialog"
            aria-label={lightbox.photo.label}
            onClick={() => { setLightbox(null) }}
          >
            <img
              className={css.lightboxImg}
              src={vaultImageUrl(lightbox.sha)}
              alt={lightbox.photo.label}
            />
            <div className={css.lightboxBar}>
              <span>{lightbox.photo.label}</span>
              <span>
                {String(lightbox.photo.blobs.display.width)} × {String(lightbox.photo.blobs.display.height)}
              </span>
              <span>点任意处关闭</span>
            </div>
            <button
              type="button"
              className={css.photoDel}
              style={{ opacity: 1, top: 18, right: 18, width: 30, height: 30 }}
              aria-label="关闭大图"
              onClick={(event) => { event.stopPropagation(); setLightbox(null) }}
            >
              <CloseIcon size={15} />
            </button>
          </div>
        ),
        document.body,
      )}
    </>
  )
}
