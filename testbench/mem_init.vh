// Shared deterministic memory contents, included by the memory model and the
// reference model so both start from the same image. Every byte differs from
// its neighbours and from the same offset in other blocks, so a wrong block,
// wrong word or wrong byte shows up as a data mismatch.
function [7:0] init_byte(input [31:0] i);
    init_byte = (i * 8'd167) + (i >> 8) * 8'd13 + 8'h5A;
endfunction
