// Documento.js
import React, { useState } from 'react';

const Documento = ({ documento, nivel = 0, onExpand }) => {
  const [expandido, setExpandido] = useState(false);

  const handleExpandir = () => {
    setExpandido(!expandido);
    onExpand(documento.id, expandido);
  };

  return (
    <>
      <tr>
        <td colSpan="9" className={`border p-2`}>
          <div>
            <span>{documento.numero}</span>
            {documento.subdocumentos && (
              <button onClick={handleExpandir}>
                {expandido ? 'Contraer' : 'Expandir'}
              </button>
            )}
          </div>
        </td>
      </tr>
      {expandido && documento.subdocumentos && (
        <>
          {documento.subdocumentos.map((subdocumento) => (
            <Documento key={subdocumento.id} documento={subdocumento} nivel={nivel + 1} onExpand={onExpand} />
          ))}
        </>
      )}
    </>
  );
};

export default Documento;
