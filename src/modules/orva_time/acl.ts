/**
 * One feature, for the reconcile command.
 *
 * The sync itself runs as an effect of writes the user was already allowed to
 * make, so it needs no feature of its own. Running the reconcile by hand
 * rewrites rows across two modules, which is an operator action.
 */
export const features = [
  { id: 'orva_time.sync.run', title: 'Run the project sync', module: 'orva_time' },
]

export default features
