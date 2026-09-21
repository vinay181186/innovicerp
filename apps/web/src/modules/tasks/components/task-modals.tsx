// Task Board modals — one import point, kept so existing callers
// (assign-task-button.tsx and any screen that reached for `Overlay`) do not
// move. The modals themselves live in their own files (ADR-176 split — the
// original single file passed 400 lines):
//   task-overlay.tsx        Overlay shell (+ FormNote / FormError)
//   assign-task-modal.tsx   "+ Assign Task" (600px)
//   todo-modal.tsx          "+ My To-Do" (500px)
//   task-detail-modal.tsx   View (facts / attachments / remarks / timeline)
//   task-action-modals.tsx  Update Status / Complete / Reassign / Cancel / Edit

export { Overlay } from './task-overlay';
export { AssignTaskModal } from './assign-task-modal';
export { TodoModal } from './todo-modal';
export { TaskDetailModal, TaskDetailModal as ViewTaskModal } from './task-detail-modal';
export {
  CancelModal,
  CompleteModal,
  EditTaskModal,
  ReassignModal,
  UpdateStatusModal,
} from './task-action-modals';
