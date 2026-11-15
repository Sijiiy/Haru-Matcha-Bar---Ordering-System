import Modal from '../../components/ui/Modal.jsx'

function ClearOrderDialog({ onCancel, onConfirm }) {
  return (
    <Modal
      titleId="clear-order-title"
      descriptionId="clear-order-description"
      role="alertdialog"
      className="clear-order-dialog"
      onClose={onCancel}
    >
      <p className="state-eyebrow">Start fresh</p>
      <h2 id="clear-order-title">Clear your order?</h2>
      <p id="clear-order-description">
        All selected drinks will be removed. You can then start a new order from the menu.
      </p>
      <div className="clear-order-dialog__actions">
        <button className="cancel-clear-order" type="button" onClick={onCancel}>Cancel</button>
        <button className="order-button" type="button" onClick={onConfirm}>Clear order</button>
      </div>
    </Modal>
  )
}

export default ClearOrderDialog
