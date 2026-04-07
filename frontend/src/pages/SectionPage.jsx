export default function SectionPage({ title, description, children }) {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold text-gray-900">{title}</h2>
        {description ? (
          <p className="text-sm text-gray-500">{description}</p>
        ) : null}
      </div>

      {children ?? (
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6 text-gray-600">
          <p>
            This is the <span className="font-semibold text-gray-800">{title}</span>{' '}
            section. Connect it to your backend when you’re ready.
          </p>
        </div>
      )}
    </div>
  );
}

