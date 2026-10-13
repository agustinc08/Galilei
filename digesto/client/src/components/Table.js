// Table.js
import React, { useState, useEffect, useMemo } from 'react';
import { Eye, File, FilePlus, Edit, Trash2 } from 'react-feather';
import ModalEditar from './ModalEditar';
import ModalVer from './ModalVer';
import ModalAgregar from './ModalAgregar';
import ModalConfirmar from './ModalConfirmar';
import Pagination from './Pagination';
import { ToastContainer, toast } from 'react-toastify';

const Table = ({ documentos, filteredDocumentos, isAdmin, onDelete, fetchData, orderBy, orderDirection, handleOrderByClick }) => {
  const [expandedDocuments, setExpandedDocuments] = useState([]);
  const [expandingDocument, setExpandingDocument] = useState(null);
  const [editDocument, setEditDocument] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState(null);
  const [documentsPerPage, setDocumentsPerPage] = useState(20);
  const [showModalVer, setShowModalVer] = useState(false);
  const [modalVerDocumento, setModalVerDocumento] = useState(null);
  const [showNoResultsMessage, setShowNoResultsMessage] = useState(false);

  const handleModalVer = (documento) => {
    const parentDocument = findParentDocument(documento.id, documentos);
    setModalVerDocumento({ ...documento, parentDocument });
    setShowModalVer(true);
  };

  const findParentDocument = (documentId, documentosArray) => {
  for (const documento of documentosArray) {
    if (documento.subdocumentos && documento.subdocumentos.length > 0) {
      if (documento.subdocumentos.some(sub => sub.id === documentId)) {
        return documento;
      } else {
        const foundParent = findParentDocument(documentId, documento.subdocumentos);
        if (foundParent) {
          return foundParent;
        }
      }
    }
  }
  return null;
};

  const [showModalAgregar, setShowModalAgregar] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState(null);

  const handleModalAgregar = (documentoAsociado) => {
    setSelectedDocument(documentoAsociado); // Establece selectedDocument con el documento asociado
    setShowModalAgregar(true);
  };


  const isLastDocument = (documento) => {
    const totalDocuments = (filteredDocumentos || documentos)?.length;
    const isLastInMainList = (filteredDocumentos || documentos)?.indexOf(documento) === totalDocuments - 1;
    const isExpanded = expandedDocuments.includes(documento.id);

    return isLastInMainList && !isExpanded;
  };

  const handleExpand = (documentoId, isExpanded) => {
    setExpandingDocument(isExpanded ? null : documentoId);
    setExpandedDocuments((prevExpanded) => {
      if (isExpanded) {
        return prevExpanded.filter((id) => id !== documentoId);
      } else {
        return [...prevExpanded, documentoId];
      }
    });
  };

  const handleEdit = (documentoId) => {
    // Busca el documento en la lista principal de documentos
    let documento = (filteredDocumentos || documentos)?.find(doc => doc.id === documentoId);

    // Si no se encuentra en la lista principal, busca en los subdocumentos
    if (!documento && (filteredDocumentos || documentos)) {
      documento = buscarEnSubdocumentos((filteredDocumentos || documentos), documentoId);
    }

    if (documento) {
      setEditDocument(documento);
    }
  };
  const handleCloseEdit = () => {
    setEditDocument(null);
  };

  const handleSaveEdit = (editedDocumento) => {

    handleCloseEdit();
  };

  useEffect(() => {
    console.log('Estado del modal actualizado:', editDocument);
  }, [editDocument]);

  const formatFecha = (fecha) => {
    const [dia, mes, anio] = fecha.split('/');
    return `${mes}/${dia}/${anio}`;
  };

  const sortedDocumentos = useMemo(() => {
    const sorted = [...(filteredDocumentos || documentos)];


    if (orderBy === 'fecha') {
      sorted.sort((a, b) => {
        const dateA = new Date(formatFecha(a.fecha)).getTime();
        const dateB = new Date(formatFecha(b.fecha)).getTime();
        return orderDirection === 'asc' ? dateA - dateB : dateB - dateA;
      });
    }


    if (orderBy === 'ID') {
      sorted.sort((a, b) => {
        return orderDirection === 'asc' ? b.id - a.id : a.id - b.id;
      });
    }

    // Agrega lógica similar para otras columnas si es necesario

    return sorted;
  }, [filteredDocumentos, documentos, orderBy, orderDirection]);

  const indexOfLastDocument = currentPage * documentsPerPage;
  const indexOfFirstDocument = indexOfLastDocument - documentsPerPage;
  const currentDocuments = sortedDocumentos.slice(indexOfFirstDocument, indexOfLastDocument);


  const handleDelete = (documentoId) => {
    const documento = findDocumentById(documentoId);
    if (documento.subdocumentos.length < 1) {
      if (documento) {
        setDocumentToDelete(documento);
        setShowDeleteConfirmation(true);
      }
    } else {
      toast.error("No se puede eliminar un documento relacionado. Primero elimina a sus subdocumentos.", {autoClose: 4000});
    }

  };

  const handleConfirmDelete = () => {
    if (documentToDelete) {
      fetch(`https://cncivil04.pjn.gov.ar/api/carga-de-datos/borrar-datos/${documentToDelete.id}`, {
        method: 'DELETE',
      })
        .then(response => {
          if (!response.ok) {
            throw new Error('Error al eliminar el documento');
          }
          return response.json();
        })
        .then(data => {
          // Hacer algo con la respuesta si es necesario
          // Actualizar la lista de documentos después de eliminar el documento
          fetchData();

          // Remover el documento eliminado de los estados de expansión
          setExpandedDocuments(prevExpanded => prevExpanded.filter(id => id !== documentToDelete.id));
          setExpandingDocument(null); // Mover aquí la llamada a setExpandingDocument

        })
        .catch(error => {
          // Manejar errores
          console.error('Error al eliminar el documento:', error);
        })
        .finally(() => {
          setDocumentToDelete(null);
          setShowDeleteConfirmation(false);
        });
    }
  };



  const handleCancelDelete = () => {
    // Limpiar el estado si se cancela la eliminación
    setDocumentToDelete(null);
    setShowDeleteConfirmation(false);
  };
  const handleModalAgregarClose = () => {
    setShowModalAgregar(false);
    fetchData();
  };

  const findDocumentById = (documentId, documentosArray = documentos) => {
    for (const documento of documentosArray) {
      if (documento.id === documentId) {
        return documento;
      }

      if (documento.subdocumentos && documento.subdocumentos.length > 0) {
        const subdocument = findDocumentById(documentId, documento.subdocumentos);
        if (subdocument) {
          return subdocument;
        }
      }
    }

    return null;
  };



  const renderDocument = (documento, nivel = 0, isParentExpanded = false, isLast = false, handleEdit) => {
    const isExpanded = expandedDocuments.includes(documento.id);
    const isLastInMainList = (filteredDocumentos || documentos)?.indexOf(documento) === totalDocuments - 1;
    const isLastDocument = isLastInMainList && !isExpanded;

    const openPdfInNewTab = (pdfUrl) => {
      window.open(pdfUrl, '_blank');
    };


    return (
      <React.Fragment key={documento.id}>
        <tr className={`text-center fade-in-from-top ${isExpanded || isParentExpanded ? 'bg-gray-200 border-t border-gray-100 hover:bg-gray-300' : 'hover:bg-gray-50'} ${documento.pendiente ? 'bg-red-200 hover:bg-red-300' : ''}`}>
          <td className="p-2 py-4 text-start">
            <div className="pl-2">
              <button
                className={`py-1 px-2 mr-2 rounded ${documento.subdocumentos && documento.subdocumentos.length > 0 ? 'bg-gray-500 text-white' : 'text-transparent'}`}
                onClick={() => handleExpand(documento.id, expandedDocuments.includes(documento.id))}
                disabled={!documento.subdocumentos || documento.subdocumentos.length === 0}
              >
                {expandedDocuments.includes(documento.id) ? '-' : '+'}
              </button>
            </div>
          </td>
          <td className="p-2 py-4">{documento.numero}</td>
          <td className="p-2 py-4">{documento.fecha}</td>
          <td className="p-2 py-4">{documento.nombreTipo}</td>
          <td className="p-2 py-4">{documento.voces}</td>
          <td className="p-2 py-4">
            <button className='p-2 bg-blue-500 text-white rounded-full hover:bg-blue-600 focus:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-600' onClick={() => handleModalVer(documento)}>
              <Eye size="20" />
            </button>
          </td>
          <td className="p-2 py-4">
            <button className='p-2 bg-white text-red-500 rounded-full shadow-md hover:bg-neutral-200 focus:bg-neutral-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-neutral-200' onClick={() => openPdfInNewTab(documento.path)}>
              <File size="20" />
            </button>
          </td>
          {isAdmin && (
            <td className="p-2 py-4" onClick={() => handleModalAgregar(documento)}>
              <button className='p-2 bg-green-500 text-white rounded-full hover:bg-green-600 focus:bg-green-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-600'>
                <FilePlus size="20" />
              </button>
            </td>
          )}
          {isAdmin && showDeleteConfirmation && documentToDelete && (
            <ModalConfirmar
              title="Eliminar documento"
              message={`¿Estás seguro de que deseas eliminar el documento ${documentToDelete.numero}?`}
              onCancel={handleCancelDelete}
              onConfirm={handleConfirmDelete}
            />
          )}
          {isAdmin && (
            <td className="p-2 py-4">
              <button className='p-2 bg-yellow-400 text-white rounded-full hover:bg-yellow-500 focus:bg-yellow-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500' onClick={() => handleEdit(documento.id)} >
                <Edit size="20" />
              </button>
            </td>
          )}
          {isAdmin && (
            <td className="p-2 py-4">
              <button className='p-2 bg-red-500 text-white rounded-full hover:bg-red-600 focus:bg-red-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-600' onClick={() => handleDelete(documento.id)}>
                <Trash2 size="20" />
              </button>
            </td>
          )}
        </tr>
        {expandedDocuments.includes(documento.id) &&
          documento.subdocumentos &&
          documento.subdocumentos.map((subdocumento, index, array) =>
            renderDocument(subdocumento, nivel + 1, isExpanded, index === array.length - 1, handleEdit))
        }

      </React.Fragment>
    );
  };

  const paginate = (pageNumber) => {
    setCurrentPage(pageNumber);
  };
  const totalDocuments = (filteredDocumentos || documentos)?.length;
  const endDocumentIndex = Math.min(indexOfLastDocument, totalDocuments);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setShowNoResultsMessage(true);
    }, 500);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [totalDocuments]);

  return (
    <div>
      {showNoResultsMessage && totalDocuments === 0 ? (
        <div className="text-center my-20">
          <p className="font-bold text-gray-700">No se encontraron documentos.</p>
        </div>
      ) : (
        <>
          <table className="table-auto w-full bg-gray-200 rounded rounded-lg shadow-2xl fade-in-from-top">
            <thead>
              <tr className='bg-gray-700 text-white text-center text-sm uppercase tracking-wider'>
                <th className="p-2 py-4 rounded-tl-lg"></th>
                <th className="p-2 py-4 cursor-pointer" onClick={() => handleOrderByClick('ID')}>
                  ID {orderBy === 'ID' && (
                    <span className='text-xs'>{orderDirection === 'asc' ? '▲' : '▼'}</span>
                  )}
                </th>
                <th className="p-2 py-4 cursor-pointer" onClick={() => handleOrderByClick('fecha')}>
                  Fecha {orderBy === 'fecha' && (
                    <span className='text-xs'>{orderDirection === 'asc' ? '▲' : '▼'}</span>
                  )}
                </th>
                <th className="p-2 py-4">Tipo</th>
                <th className="p-2 py-4">Voces</th>
                <th className="p-2 py-4">Ver más</th>
                <th className={`p-2 py-4 ${!isAdmin ? 'rounded-tr-lg' : ''}`}>PDF</th>
                {isAdmin && (
                  <th className="p-2 py-4">Agregar</th>
                )}
                {isAdmin && (
                  <th className="p-2 py-4">Editar</th>
                )}
                {isAdmin && (
                  <th className="p-2 py-4 rounded-tr-lg">Eliminar</th>
                )}
              </tr>
            </thead>
            <tbody className='bg-white'>
              {currentDocuments.map((documento) => renderDocument(documento, 0, false, isLastDocument(documento), handleEdit, handleModalVer))}
            </tbody>
          </table>

          <div className="my-10">
            <div className='flex justify-between items-center'>
              <div className='text-xs'>
                {`Total de resultados: ${endDocumentIndex} de ${totalDocuments}`}
              </div>

              <Pagination
                currentPage={currentPage}
                totalPages={Math.ceil(totalDocuments / documentsPerPage)}
                paginate={paginate}
              />

              <div>
                <label className="mr-2">Mostrar:</label>
                <select
                  className="px-2 py-1 border-2 border-transparent rounded focus:outline-blue-500 focus:border-blue-500"
                  value={documentsPerPage}
                  onChange={(e) => setDocumentsPerPage(Number(e.target.value))}
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={30}>30</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>
          </div>
        </>
      )}
      {editDocument && (
        <ModalEditar
          documento={editDocument}
          onClose={handleCloseEdit}
          onSave={handleModalAgregarClose}
        />
      )}
      {modalVerDocumento && (
        <ModalVer
          show={showModalVer}
          onHide={() => setShowModalVer(false)}
          documento={modalVerDocumento}
          documentoPadre={modalVerDocumento.documentoPadre}
          handleModalVer={handleModalVer}
        />
      )}
      {showModalAgregar && (
        <ModalAgregar
          show={showModalAgregar}
          onHide={handleModalAgregarClose}
          documentoAsociado={selectedDocument}
        />
      )}
    </div>
  );
};

export default Table;


const buscarEnSubdocumentos = (documentos, documentoId) => {
  for (const documento of documentos) {
    if (documento.id === documentoId) {
      return documento;
    }
    if (documento.subdocumentos && documento.subdocumentos.length > 0) {
      const resultado = buscarEnSubdocumentos(documento.subdocumentos, documentoId);
      if (resultado) {
        return resultado;
      }
    }
  }
  return null;
};