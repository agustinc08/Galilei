import React from 'react';

const Pagination = ({ currentPage, totalPages, paginate }) => {
    const maxPagesToShow = 7;

    // Calcular el rango de páginas a mostrar
    let startPage, endPage;
    if (totalPages <= maxPagesToShow) {
      // Mostrar todas las páginas si el total es menor o igual al máximo permitido
      startPage = 1;
      endPage = totalPages;
    } else {
      // Calcular el rango de páginas para mostrar
      const halfPagesToShow = Math.floor(maxPagesToShow / 2);
      if (currentPage <= halfPagesToShow) {
        // Primeras páginas
        startPage = 1;
        endPage = maxPagesToShow;
      } else if (currentPage + halfPagesToShow >= totalPages) {
        // Últimas páginas
        startPage = totalPages - maxPagesToShow + 1;
        endPage = totalPages;
      } else {
        // Páginas intermedias
        startPage = currentPage - halfPagesToShow;
        endPage = currentPage + halfPagesToShow;
      }
    }

    return (
      <ul className="flex justify-center">
        {/* Botón "<<" */}
        <li
          className={`mx-1 cursor-pointer py-2 px-3 rounded ${
            currentPage === 1 ? 'pointer-events-none opacity-50' : ''
          }`}
          onClick={() => paginate(1)}
        >
          {"<<"}
        </li>

        {/* Páginas */}
        {Array.from({ length: endPage - startPage + 1 }, (_, index) => startPage + index).map((number) => (
          <li
            key={number}
            className={`mx-1 cursor-pointer py-2 px-3 rounded ${
              currentPage === number ? 'font-bold shadow-md bg-blue-500 text-white' : ''
            }`}
            onClick={() => paginate(number)}
          >
            {number}
          </li>
        ))}

        {/* Botón ">>" */}
        <li
          className={`mx-1 cursor-pointer py-2 px-3 rounded ${
            currentPage === totalPages ? 'pointer-events-none opacity-50' : ''
          }`}
          onClick={() => paginate(totalPages)}
        >
          {">>"}
        </li>
      </ul>
    );
  };

  export default Pagination;