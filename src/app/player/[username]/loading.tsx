export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[100rem] px-4 py-6 sm:px-6" aria-busy="true">
      <p className="sr-only" role="status">
        Loading player data
      </p>
      <div className="card overflow-hidden">
        <div className="flex items-center gap-4 p-4 sm:p-5">
          <div className="h-16 w-16 shrink-0 rounded-xl bg-surface-3 sm:h-[4.5rem] sm:w-[4.5rem]" />
          <div className="flex-1 space-y-3">
            <div className="h-6 w-56 max-w-full rounded bg-surface-3" />
            <div className="h-3 w-72 max-w-full rounded bg-surface-2" />
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-line sm:grid-cols-4 lg:grid-cols-8">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="tile h-[4.75rem]">
              <div className="h-2 w-16 rounded bg-surface-3" />
              <div className="mt-3 h-5 w-14 rounded bg-surface-3" />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
        <div className="panel h-96" />
        <div className="grid gap-4">
          <div className="panel h-44" />
          <div className="panel h-56" />
        </div>
      </div>
    </div>
  );
}
