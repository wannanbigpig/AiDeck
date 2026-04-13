import Modal from '../../components/Modal'

export default function CodexTagModals ({
  tagEditor,
  onTagEditorChange,
  onCloseTagEditor,
  onSaveTags,
  batchTagEditor,
  selectedCount,
  onBatchTagValueChange,
  onCloseBatchTagEditor,
  onSaveBatchTags
}) {
  return (
    <>
      <Modal
        title='编辑账号标签'
        open={!!tagEditor.id}
        onClose={onCloseTagEditor}
        footer={
          <>
            <button className='btn' onClick={onCloseTagEditor}>取消</button>
            <button className='btn btn-primary' onClick={onSaveTags}>保存</button>
          </>
        }
      >
        <div className='form-group'>
          <label className='form-label'>标签（英文逗号分隔）</label>
          <input
            className='form-input'
            value={tagEditor.value}
            onChange={(e) => onTagEditorChange(e.target.value)}
            placeholder='例如: 主力, 备用, 稳定'
          />
        </div>
      </Modal>

      <Modal
        title='批量设置标签'
        open={batchTagEditor.open}
        onClose={onCloseBatchTagEditor}
        footer={
          <>
            <button className='btn' onClick={onCloseBatchTagEditor}>取消</button>
            <button className='btn btn-primary' onClick={onSaveBatchTags}>保存</button>
          </>
        }
      >
        <div className='form-group'>
          <label className='form-label'>已选 {selectedCount} 个账号，标签使用逗号分隔</label>
          <input
            className='form-input'
            value={batchTagEditor.value}
            onChange={(e) => onBatchTagValueChange(e.target.value)}
            placeholder='例如: 主力, 备用, 稳定'
          />
        </div>
      </Modal>
    </>
  )
}
