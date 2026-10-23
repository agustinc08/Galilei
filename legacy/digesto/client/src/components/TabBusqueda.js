import React, { useState, useEffect } from 'react';
import Filters from './Filters';
import Table from './Table';

const TabBusqueda = ({ isAdmin }) => {
  // Lógica relacionada con la búsqueda y paginación
  const [documentos, setDocumentos] = useState([]); // Mantén documentos como estado inicial
  const [filteredDocumentos, setFilteredDocumentos] = useState([]);
  const [orderBy, setOrderBy] = useState('ID');
  const [orderDirection, setOrderDirection] = useState('asc'); // 'asc' o 'desc'


  const searchInDocumentos = (documentos, filters) => {
    const searchResult = [];
    const matchedRoots = new Set(); // Conjunto para almacenar las raíces de los documentos que han hecho match

    const searchInSubdocumentos = (subdocumentos, padres = []) => {
      subdocumentos.forEach(subdocumento => {
        const subdocumentoMatchesFilters = matchesFilters(subdocumento, filters);
        if (subdocumentoMatchesFilters) {
          // Agrega el subdocumento al resultado
          searchResult.push(subdocumento);
          // Agrega la raíz del subdocumento al conjunto de raíces que han hecho match
          matchedRoots.add(padres[0]);
        } else {
          // Si el subdocumento no coincide con los filtros, busca en sus subdocumentos
          if (subdocumento.subdocumentos) {
            searchInSubdocumentos(subdocumento.subdocumentos, [subdocumento, ...padres]);
          }
        }
      });
    };

    documentos.forEach(documento => {
      const documentoMatchesFilters = matchesFilters(documento, filters);
      if (documentoMatchesFilters) {
        // Agrega el documento raíz al resultado solo si no es una raíz contenida en matchedRoots
        if (!matchedRoots.has(documento)) {
          searchResult.push(documento);
        }
      } else {
        // Si el documento raíz no coincide con los filtros, busca en sus subdocumentos
        if (documento.subdocumentos) {
          searchInSubdocumentos(documento.subdocumentos, [documento]);
        }
      }
    });

    return searchResult;
  };

  const matchesFilters = (documento, filters) => {
    const fechaInicio = filters.fechaDesde ? new Date(filters.fechaDesde) : null;
    const fechaFin = filters.fechaHasta ? new Date(filters.fechaHasta) : null;
    const documentoFecha = new Date(formatearFecha(documento.fecha));
    const contentPdf = documento.pdfContent;
    const buscarPdf = filters.buscarPDF;
    const pdfContentMatch = !contentPdf || contentPdf.includes(buscarPdf);
    const numeroMatch = !filters.numero || documento.numero.includes(filters.numero);
    const fechaDesdePresente = fechaInicio !== null;
    const fechaHastaPresente = fechaFin !== null;
    const fechaDesdeCumplida = !fechaDesdePresente || documentoFecha >= fechaInicio;
    const fechaHastaCumplida = !fechaHastaPresente || documentoFecha <= fechaFin;
    const fechaMatch =
      (!fechaDesdePresente && !fechaHastaPresente) ||
      (fechaDesdePresente && !fechaHastaPresente && fechaDesdeCumplida) ||
      (!fechaDesdePresente && fechaHastaPresente && fechaHastaCumplida) ||
      (fechaDesdePresente && fechaHastaPresente && fechaDesdeCumplida && fechaHastaCumplida);
    const tipoMatch = !filters.tipo || documento.nombreTipo.includes(filters.tipo);
    const vocesMatch = !filters.voces || documento.voces.includes(filters.voces);
    const dependMatch = !filters.dependencia || documento.dependencias.some(dep => String(dep.id) === filters.dependencia);

    return numeroMatch && dependMatch && tipoMatch && vocesMatch && pdfContentMatch && fechaMatch;
  };

  const handleClearFilters = () => {
    // Lógica para limpiar los filtros en el componente padre
    // Por ejemplo, volver a cargar los datos para la tabla
    fetchData(); // Vuelve a cargar los datos después de limpiar los filtros
  };


  const handleSearch = (filters) => {
    const results = searchInDocumentos(documentos, filters);

    // Aplica la ordenación si se ha seleccionado una columna de ordenación
    if (orderBy) {
      const sortedResults = results.sort((a, b) => {
        const orderValueA = a[orderBy];
        const orderValueB = b[orderBy];

        if (orderValueA < orderValueB) {
          return orderDirection === 'asc' ? -1 : 1;
        }
        if (orderValueA > orderValueB) {
          return orderDirection === 'asc' ? 1 : -1;
        }
        return 0;
      });

      setFilteredDocumentos(sortedResults);
    } else {
      setFilteredDocumentos(results || []);
    }
  };


  const handleDelete = (documentoId) => {
    const updatedDocumentos = deleteDocument(documentos, documentoId);
    setDocumentos(updatedDocumentos);
    setFilteredDocumentos(updatedDocumentos);

  };

  const handleOrderByClick = (column) => {
    if (orderBy === column) {
      setOrderDirection(orderDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setOrderBy(column);
      setOrderDirection('asc');
    }
  };


  const deleteDocument = (documentos, targetId) => {
    return documentos.map((documento) => {
      if (documento.id === targetId) {
        // No incluir el documento y sus subdocumentos si es el objetivo
        return null;
      }

      if (documento.subdocumentos && documento.subdocumentos.length > 0) {
        // Filtrar los subdocumentos eliminando los nulos resultantes de la recursión
        documento.subdocumentos = deleteDocument(documento.subdocumentos, targetId).filter(Boolean);
      }

      return documento;
    }).filter(Boolean); // Filtrar los documentos eliminando los nulos resultantes
  };


  const fetchData = async () => {
    try {
      const response = await fetch('https://cncivil04.pjn.gov.ar/api/carga-de-datos/obtener-datos?fechaFin=9999-08-06T00:00:00Z&fechaInicio=0001-08-06T00:00:00Z&texto=&textoPdf=');

      const data = await response.json();
      const buildDocument = (doc) => {
        // Convertir la fecha a un objeto Date
        const fecha = new Date(doc.fecha);

        // Obtener día, mes y año
        const dia = fecha.getUTCDate().toString().padStart(2, '0');
        const mes = (fecha.getUTCMonth() + 1).toString().padStart(2, '0'); // El mes comienza desde 0
        const anio = fecha.getUTCFullYear();

        // Formatear la fecha como dd/mm/aaaa
        const fechaFormateada = `${dia}/${mes}/${anio}`;

        return {
          id: doc.id,
          numero: doc.numero,
          fecha: fechaFormateada,
          tipo: doc.tipo,
          nombreTipo: doc.nombreTipo,
          voces: doc.voz,
          path: doc.pdfUrl,
          idDocAsociado: doc.idDocAsociado,
          dependencias: doc.dependencias.map(dep => ({ id: dep.id, dependencia: dep.nombre })),
          subdocumentos: [], // Inicialmente vacío, se llenará más adelante
          pdfContent: doc.pdfContent, // Agregar pdfContent
          pendiente: doc.pendiente
        };
      };


      // Mapear los datos recibidos y construir la estructura de documentos
      const documentos = data.data.map(doc => buildDocument(doc));
      // Construir los subdocumentos y agregarlos a los documentos correspondientes
      documentos.forEach(doc => {
        if (doc.idDocAsociado !== 0) {
          const parentDoc = documentos.find(parent => parent.id === doc.idDocAsociado);
          if (parentDoc) {
            parentDoc.subdocumentos.push(doc);
          }
        }
      });

      // Filtrar los documentos principales que no tienen idDocAsociado
      const mainDocumentos = documentos.filter(doc => doc.idDocAsociado === 0);
      // Actualizar el estado con los documentos procesados
      setDocumentos(mainDocumentos);
      setFilteredDocumentos(mainDocumentos);
    } catch (error) {
      console.error('Error al obtener datos:', error);
    }
  };

  useEffect(() => {


    fetchData();
  }, []);

  return (
    <div>
      <Filters onSearch={handleSearch} onClear={handleClearFilters} />
      <Table
        documentos={documentos}
        filteredDocumentos={filteredDocumentos}
        isAdmin={isAdmin}
        onDelete={handleDelete}
        fetchData={fetchData} // Pasa la función fetchData como una prop
        orderBy={orderBy}
        orderDirection={orderDirection}
        handleOrderByClick={handleOrderByClick}
      />

      {/* Aquí puedes incluir la lógica para los filtros y la paginación */}
    </div>
  );
};

export default TabBusqueda;

function formatearFecha(fecha) {
  const partesFecha = fecha.split('/');
  // Las partes de la fecha se asumen en el orden DD/MM/YYYY
  const anio = partesFecha[2];
  const mes = partesFecha[1].padStart(2, '0'); // Asegura que el mes tenga dos dígitos
  const dia = partesFecha[0].padStart(2, '0'); // Asegura que el día tenga dos dígitos
  return `${anio}-${mes}-${dia}`;
}