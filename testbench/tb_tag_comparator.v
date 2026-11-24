// Unit test: tag_comparator. Exhaustive for a small tag width, plus corner and random cases for the real 22-bit tag.
`timescale 1ns/1ps
module tb_tag_comparator;
    reg  [21:0] s, r;  wire m;
    tag_comparator #(.TAG_W(22)) dut (.stored_tag(s), .request_tag(r), .match(m));
    reg  [2:0] s3, r3; wire m3;
    tag_comparator #(.TAG_W(3)) dut3 (.stored_tag(s3), .request_tag(r3), .match(m3));

    integer i, j, errors = 0, checks = 0;
    task chk(input cond, input [255:0] what);
        begin
            checks = checks + 1;
            if (!cond) begin errors = errors + 1; $display("FAIL %0s stored=%h request=%h", what, s, r); end
        end
    endtask
    initial begin
        // exhaustive: 3-bit tags (64 combinations)
        for (i = 0; i < 8; i = i + 1) for (j = 0; j < 8; j = j + 1) begin
            s3 = i; r3 = j; #1; chk(m3 === (i == j), "3-bit exhaustive");
        end
        // corner cases, 22-bit
        s = 0;          r = 0;          #1; chk(m === 1'b1, "zero == zero");
        s = 22'h3FFFFF; r = 22'h3FFFFF; #1; chk(m === 1'b1, "all ones");
        s = 22'h000001; r = 22'h000000; #1; chk(m === 1'b0, "differ in bit 0");
        s = 22'h200000; r = 22'h000000; #1; chk(m === 1'b0, "differ in bit 21 (MSB)");
        s = 22'h155555; r = 22'h2AAAAA; #1; chk(m === 1'b0, "alternating bits");
        // each single-bit difference is detected
        for (i = 0; i < 22; i = i + 1) begin s = 22'h123456; r = s ^ (22'd1 << i); #1; chk(m === 1'b0, "single bit flip"); end
        // random
        for (i = 0; i < 5000; i = i + 1) begin s = $random; r = (i % 2) ? s : $random; #1; chk(m === (s == r), "random"); end
        if (errors == 0) $display("tb_tag_comparator: PASS (%0d checks, 0 failures)", checks);
        else begin $display("tb_tag_comparator: FAIL (%0d of %0d checks failed)", errors, checks); $fatal(1); end
        $finish;
    end
endmodule
