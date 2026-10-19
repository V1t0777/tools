/** P3.8: player-initiated, read-only suggestions based on live P2 rules.
 * Never mutates a save, creates items or automatically performs an operation.
 */
import { diagnoseBoard } from './board-diagnostics.mjs';

const index = value => Number.isInteger(value) && value >= 0 && value < 56;
const itemSlots = values => values.filter(index);

/** Returns UI-ready data, not executable commands. Re-run before showing it. */
export function getBoardGuidance(state) {
  const diagnosis = diagnoseBoard(state);
  const hint = diagnosis.hint;
  const root = {
    revision: state.revision,
    recovery: diagnosis.recovery,
    pressure: diagnosis.board.pressure,
    freeCells: diagnosis.board.free,
    message: '',
    boardSlots: [],
    warehouseSlot: null,
    orderId: null,
    warehouseUpgrade: false,
    type: hint?.type ?? 'no-path'
  };
  if (!hint) {
    return { ...root, message:diagnosis.recovery === 'hard-deadlock'
      ? '目前没有可腾出空格的合法操作。请保留存档，不要直接重置；此局面需要后续救援机制。'
      : '暂时没有可执行的整理步骤，可以稍后再查看。' };
  }
  switch (hint.type) {
    case 'order':
      return {...root, orderId:hint.orderId, message:'已有可以交付的委托。请点击标出的「交付委托」按钮腾出一格。'};
    case 'move':
      return {...root, boardSlots:itemSlots([hint.from,hint.to]), message:'已标出两件能够合成的物品。依次点击它们即可腾出一格。'};
    case 'withdraw':
      return {...root, warehouseSlot:hint.slot, message:'仓库里有当前委托需要的物品。点击标出的仓库格，取出后交付。'};
    case 'store':
      return {...root, boardSlots:itemSlots([hint.slot]), message:'棋盘已满。先选中标出的原料，再点击「收入仓库」。'};
    case 'upgradeWarehouse':
      return {...root, warehouseUpgrade:true, message:'棋盘和仓库都已满。金币与等级允许扩容，点击标出的仓库升级按钮。'};
    case 'produce':
      return {...root, boardSlots:itemSlots([hint.slot]), message:'可以点击标出的工坊继续生产。'};
    case 'wait':
      return {...root, message:hint.message};
    default:
      return {...root, type:'no-path', message:'暂时无法提供可靠提示；请保留当前存档。'};
  }
}
